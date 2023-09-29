const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { describe } = require("mocha");
require("@nomicfoundation/hardhat-chai-matchers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { toBigInt } = require("ethers");




const AddressZero = ethers.ZeroAddress;
const ETH_IN_WEI = ethers.parseEther('1')
const FIVE_ETH_IN_WEI = ethers.parseEther('5')
const START_DELAY = 3600;
const START_TIMESTAMP = parseInt(Date.now() / 1000) + START_DELAY;
const SALE_DURATION = 36 //In hours
const END_TIMESTAMP = START_TIMESTAMP + (SALE_DURATION * 60 * 60);
const ETH_HARDCAP = '10' //In ETH
const ETH_HARDCAP_IN_WEI = ethers.parseEther(ETH_HARDCAP);
const sample_address = "0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326"
const LP_MINT_TOKENS = ethers.parseEther("1000000")

describe("TGE Contract", () => {
    async function deployFixture(withSale = false) {
        const [owner, account1, account2] = await ethers.getSigners();
        const WETH = await ethers.getContractFactory("WETH", owner);
        const weth = await WETH.deploy();
        await weth.waitForDeployment();

        const FXDX = await ethers.getContractFactory("FXDX", owner);
        const fxdx = await FXDX.deploy();
        await fxdx.waitForDeployment();

        const TGE = await ethers.getContractFactory("TGE", owner);

        const tge = await upgrades.deployProxy(TGE, { initializer: false })

        await tge.connect(owner).initialize(fxdx.target, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI, weth.target, AddressZero)
        await tge.waitForDeployment();
        await allocateFXDX(fxdx, owner, tge);
        await time.increase(START_DELAY)
        return { owner, account1, account2, weth, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI };
    }
    async function moveToEndOfSale(endTimestamp) {
        await time.increaseTo(endTimestamp);
    }
    async function allocateFXDX(fxdx, owner, tge) {
        fxdx.mint(owner.address, LP_MINT_TOKENS);
        fxdx.connect(owner).approve(tge.target, LP_MINT_TOKENS)
        await tge.connect(owner).allocateFXDX(LP_MINT_TOKENS);
    }
    describe("Check Contract initialisation", async () => {
        it("should have correct address of contract", async () => {
            const { owner, account1, account2, weth, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI } = await loadFixture(deployFixture);
            expect(await tge.fxdx()).to.be.equal(fxdx.target);
            expect(await tge.saleStart()).to.be.equal(START_TIMESTAMP);
            expect(await tge.saleClose()).to.be.equal(END_TIMESTAMP);
            expect(await tge.ethHardCap()).to.be.equal(ETH_HARDCAP_IN_WEI);
            expect(await tge.owner()).to.be.equal(owner.address);
        })
        it("should not be initialized twice", async () => {
            const { owner, account1, account2, weth, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI } = await loadFixture(deployFixture);
            await expect(tge.initialize(fxdx.target, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI, weth.target, AddressZero)).to.be.revertedWith("Initializable: contract is already initialized");
        })
    })
    describe("Check user Deposits functionality", () => {
        it("Fall back deposit", async () => {
            const { owner, account1, account2, weth, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI } = await loadFixture(deployFixture);
            let tx = {
                to: tge.target,
                value: ETH_IN_WEI
            }
            await account1.sendTransaction(tx);
            expect(await tge.deposits(account1.address)).to.be.equal(ETH_IN_WEI);
            expect(await tge.ethDeposited()).to.be.equal(ETH_IN_WEI)
        })
        it("users should be able to deposit", async () => {
            const { owner, account1, account2, weth, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI } = await loadFixture(deployFixture);
            await tge.connect(account1).deposit(account1.address, { value: ETH_IN_WEI });
            expect(await tge.deposits(account1.address)).to.be.equal(ETH_IN_WEI);
            expect(await tge.ethDeposited()).to.be.equal(ETH_IN_WEI)
        })
        it("multiple users much be able deposit", async () => {
            const { owner, account1, account2, weth, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI } = await loadFixture(deployFixture);
            await tge.connect(account1).deposit(account1.address, { value: ETH_IN_WEI });
            expect(await tge.deposits(account1.address)).to.be.equal(ETH_IN_WEI);
            expect(await tge.ethDeposited()).to.be.equal(ETH_IN_WEI)

            let totalDepositedBefore = await tge.ethDeposited()

            await tge.connect(account2).deposit(account2.address, { value: FIVE_ETH_IN_WEI });
            expect(await tge.deposits(account2.address)).to.be.equal(FIVE_ETH_IN_WEI);
            expect(await tge.ethDeposited()).to.be.equal(FIVE_ETH_IN_WEI + totalDepositedBefore)
        })
        it("should emit deposit event", async () => {
            const { owner, account1, account2, weth, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI } = await loadFixture(deployFixture);

            await expect(tge.connect(account1).deposit(account1.address, { value: ETH_IN_WEI })).to.emit(tge, "LogTokenDeposit")
            expect(await tge.deposits(account1.address)).to.be.equal(ETH_IN_WEI);
            expect(await tge.ethDeposited()).to.be.equal(ETH_IN_WEI)
        })
    })
    describe("User should be able to claim tokens", () => {
        it("users shouldn't be able to claim before the sale ends", async () => {
            const { owner, account1, account2, weth, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI } = await loadFixture(deployFixture);

            await tge.connect(account1).deposit(account1.address, { value: ETH_IN_WEI })
            //below params are used only for uniswap, so we can ignore it
            let params = {
                isPlaceBuyWall: false,
                minLiquidity: 0
            }
            await expect(tge.connect(account1).claimFXDX(params)).to.be.revertedWithCustomError(tge, 'SaleHasNotEnded()')
        })
        it("users should be able to claim after the sale ends", async () => {
            const { owner, account1, account2, weth, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI } = await loadFixture(deployFixture);

            await tge.connect(account1).deposit(account1.address, { value: ETH_IN_WEI })
            let params = {
                isPlaceBuyWall: false,
                minLiquidity: 0
            }
            await tge.setUniswapV3Pool(sample_address, 0)
            await moveToEndOfSale(END_TIMESTAMP);

            const claimAmount = await tge.claimableAmount(account1.address)
            await tge.connect(account1).claimFXDX(params);
            expect(await tge.deposits(account1.address)).to.be.equal(ETH_IN_WEI);
            expect(await tge.isClaimed(account1.address)).to.be.true;
            expect(await fxdx.balanceOf(account1.address)).to.be.equal(claimAmount);
        })
        it("users shouldn't be able to claim twice", async () => {
            const { owner, account1, account2, weth, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI } = await loadFixture(deployFixture);

            await tge.connect(account1).deposit(account1.address, { value: ETH_IN_WEI })
            let params = {
                isPlaceBuyWall: false,
                minLiquidity: 0
            }
            await tge.setUniswapV3Pool(sample_address, 0)
            await moveToEndOfSale(END_TIMESTAMP);

            const claimAmount = await tge.claimableAmount(account1.address)
            await tge.connect(account1).claimFXDX(params);
            const balanceAfter1stClaim = await fxdx.balanceOf(account1);
            expect(balanceAfter1stClaim).to.be.equal(claimAmount);

            await expect(tge.connect(account1).claimFXDX(params)).to.be.revertedWithCustomError(tge, 'AlreadyClaimed()');
            const balanceAfter2stClaim = await fxdx.balanceOf(account1);
            expect(balanceAfter1stClaim).to.be.equal(balanceAfter2stClaim);
        })
        it("users should be refunded if we hit hardcap", async () => {
            const { owner, account1, account2, weth, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI } = await loadFixture(deployFixture);

            await tge.connect(account1).deposit(account1.address, { value: ETH_IN_WEI })
            await tge.connect(account1).deposit(account2.address, { value: ethers.parseEther("12") })
            let params = {
                isPlaceBuyWall: false,
                minLiquidity: 0
            }
            await tge.setUniswapV3Pool(sample_address, 0)
            await moveToEndOfSale(END_TIMESTAMP);

            const refundAmount = await tge.refundAmount(account1.address);

            const balanceBeforeRefund = await ethers.provider.getBalance(account1.address);

            let txn = await tge.connect(account1).claimFXDX(params);
            txn = await txn.wait();
            const gasUsed = txn.gasUsed;
            const balanceAfterRefund = await ethers.provider.getBalance(account1.address);

            const tempBal = (parseFloat(ethers.formatEther(balanceBeforeRefund)) + parseFloat(ethers.formatEther(refundAmount))) - parseFloat(ethers.formatEther(gasUsed));
            expect(tempBal.toFixed(2)).to.be.equal((parseFloat(ethers.formatEther(balanceAfterRefund)).toFixed(2)))
        })
    })
})