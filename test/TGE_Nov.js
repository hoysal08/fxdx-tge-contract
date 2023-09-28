const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { describe, it, beforeEach } = require("mocha");
require("@nomicfoundation/hardhat-chai-matchers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { toBigInt } = require("ethers");
const abii = require("../USDCBAse.json");
const abi = abii.abi;

const AddressZero = ethers.ZeroAddress;
const ETH_IN_WEI = ethers.parseEther("1");
const FIVE_ETH_IN_WEI = ethers.parseEther("5");
const START_DELAY = 3600;
const START_TIMESTAMP = parseInt(Date.now() / 1000) + START_DELAY;
const SALE_DURATION = 2; // In hours
const END_TIMESTAMP = START_TIMESTAMP + SALE_DURATION * 60 * 60;
const ETH_HARDCAP = "10"; // In ETH
const ETH_HARDCAP_IN_WEI = ethers.parseEther(ETH_HARDCAP);
const LP_MINT_TOKENS = ethers.parseEther("1000");
const timeInSeconds = 17300;
const timeHex = "0x" + timeInSeconds.toString(16);
const timeInSecondsToStart = 7300;
const timeHexStart = "0x" + timeInSecondsToStart.toString(16);

describe("TGE", function () {
  async function deployFixture() {
    const [owner, account1, account2] = await ethers.getSigners();
    const WETH = await ethers.getContractFactory("WETH", owner);
    const weth = await WETH.deploy();
    await weth.waitForDeployment();
    const FXDX = await ethers.getContractFactory("FXDX", owner);
    const fxdx = await FXDX.deploy();
    await fxdx.waitForDeployment();
    const TGE = await ethers.getContractFactory("TGE", owner);
    const tge = await upgrades.deployProxy(TGE, { initializer: false });
    await tge
      .connect(owner)
      .initialize(
        fxdx.target,
        START_TIMESTAMP,
        END_TIMESTAMP,
        ETH_HARDCAP_IN_WEI,
        "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
        "0x4200000000000000000000000000000000000006",
        "0x2626664c2603336E57B271c5C0b26F421741e481"
      );
    await tge.waitForDeployment();
    await allocateFXDX(fxdx, owner, tge);
    await time.increase(START_DELAY);
    return {
      owner,
      account1,
      account2,
      weth,
      fxdx,
      tge,
      START_TIMESTAMP,
      END_TIMESTAMP,
      ETH_HARDCAP_IN_WEI,
    };
  }
  
  async function allocateFXDX(fxdx, owner, tge) {
    fxdx.mint(owner.address, LP_MINT_TOKENS);
    fxdx.connect(owner).approve(tge.target, LP_MINT_TOKENS);
    await expect(tge.connect(owner).allocateFXDX(LP_MINT_TOKENS)).to.emit(
      tge,
      "LogAllocateFXDX"
    );
  }

  async function depositETH(beneficiary, minOutUSD, fxdx, tge, owner) {
    const tgeWithSigner = tge.connect(beneficiary);
    const timeInSeconds = 7300;
    const timeHex = "0x" + timeInSeconds.toString(16);
    await time.increase(timeHex);
    await tgeWithSigner
      .connect(owner)
      .updateUniswapPool(500, "0x2626664c2603336E57B271c5C0b26F421741e481");
    const amountInWei = ethers.parseEther("1");
    console.log(
      await tgeWithSigner
        .connect(beneficiary)
        .depositETH(beneficiary, minOutUSD, {
          value: amountInWei,
          from: beneficiary,
        })
    );

    console.log(await tge.usdbcDeposited());
  }

  async function mintUSDC(beneficiary, amount) {
    const bridge = "0x4200000000000000000000000000000000000010";
    const addressTo = beneficiary;

    const impersonatedSigner = await ethers.getImpersonatedSigner(bridge);
    await network.provider.send("hardhat_setBalance", [
      bridge,
      "0x1000000000000000000000",
    ]);
    const signer = await ethers.getSigner(bridge);
    const usdc = await ethers.getContractAt(
      abi,
      "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
      signer
    );
    await expect(
      usdc.connect(impersonatedSigner).mint(addressTo, amount)
    ).to.emit(usdc, "Mint");
  }

  async function depositUsdbc(beneficiary, amount, tge) {
    const usdc = await ethers.getContractAt(
      abi,
      "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
      beneficiary
    );
    await usdc.connect(beneficiary).approve(tge.target, amount);
    await mintUSDC(beneficiary, amount);
    await time.increase(timeHex);

    await expect(
      tge.connect(beneficiary).depositUsdbc(beneficiary, amount)
    ).to.emit(tge, "TokenDeposit");
    await expect(tge.connect(beneficiary).depositUsdbc(beneficiary, amount))
  }

  beforeEach(async function () {
    this.fixture = await loadFixture(deployFixture);
  })

  describe("Contract Initialized Correctly", function() {
    it("should have correct address of contract", async function () {
      const {owner, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI} = this.fixture;
      expect(await tge.fxdx()).to.be.equal(fxdx.target);
      expect(await tge.saleStart()).to.be.equal(START_TIMESTAMP);
      expect(await tge.saleClose()).to.be.equal(END_TIMESTAMP);
      expect(await tge.usdbcHardCap()).to.be.equal(ETH_HARDCAP_IN_WEI);
      expect(await tge.owner()).to.be.equal(owner.address);
    });
  })

  describe("depositETH", function () {

    // Reverting if the value is 0
    it("should revert if value is 0", async function () {
      const {tge, account1} = this.fixture;
      await expect(
        tge.connect(account1).depositETH(account1.address, ethers.parseEther("0"), {
         value: ethers.parseEther("0"),
       })
     ).to.be.revertedWithCustomError(tge, 'TGE_InvalidValue()');
   });

    // Reverting if the beneficiary is 0 address
    it("should revert if beneficiary is 0 address", async function () {
      const{tge, account1} = this.fixture;
      await expect(
        tge.connect(account1).depositETH(AddressZero, ETH_IN_WEI, {
          value: ETH_IN_WEI,
        })
      ).to.be.revertedWithCustomError(tge, 'TGE_InvalidAddress()');
    });

    // Reverting if the beneficiary is contract address
    it("should revert if beneficiary is contract address", async function () {
      const{tge, owner} = this.fixture;
      await expect(
        tge.connect(owner).depositETH(tge.target, ETH_IN_WEI, {
          value: ETH_IN_WEI,
        })
      ).to.be.revertedWithCustomError(tge, 'TGE_InvalidAddress()');
    });

    // Reverting if the sale has not started
    it("should revert if sale has not started", async function () {
      const {tge, account1} = this.fixture;
      await expect(
        tge.connect(account1).depositETH(account1.address, ETH_IN_WEI, {
          value: ETH_IN_WEI,
        })
      ).to.be.revertedWithCustomError(tge, 'TGE_SaleNotStarted()');
    });

    // Reverting if the sale has ended
    it("should revert if sale has ended", async function () {
      const {tge, owner, account1} = this.fixture;
      await time.increase(timeHex);
      await expect(
        tge.connect(account1).depositETH(account1.address, ETH_IN_WEI, {
          value: ETH_IN_WEI,
          from: account1.address,
        })
      ).to.be.revertedWithCustomError(tge, 'TGE_SaleEnded()');
    });

    //Deposit ETH and transfer USDBC to beneficiary
    it("should deposit ETH and transfer USDBC to contract", async function () {
      const {tge, fxdx, owner, account1} = this.fixture;
      const usdc = await ethers.getContractAt(
        abi,
        "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        account1
      );
      await time.increase(timeHexStart);
      await tge
      .connect(owner)
      .updateUniswapPool(500, "0x2626664c2603336E57B271c5C0b26F421741e481");
      const usdbcBalanceBefore = await usdc.balanceOf(tge.target);
      await depositETH(account1, 0, fxdx, tge, owner);
      const usdbcBalanceAfter = await usdc.balanceOf(tge.target);
      expect(usdbcBalanceAfter).to.be.gt(usdbcBalanceBefore);
      expect(await tge.connect(account1).deposits(account1.address)).to.equal(
        ETH_IN_WEI
      );
    });
  });

  describe("depositUsdbc", function () {

    //If the address is 0 address 
    it("should revert if beneficiary is 0 address", async function () {
      const {tge, account1} = this.fixture;
      await expect(
        tge.connect(account1).depositUsdbc(AddressZero, ETH_IN_WEI)
      ).to.be.revertedWithCustomError(tge, 'TGE_InvalidAddress()');
    });

    it("should revert if beneficiary is contract address", async function () {
      const {tge, account1} = this.fixture;
      await expect(
        tge.connect(account1).depositUsdbc(tge.target, ETH_IN_WEI)
      ).to.be.revertedWithCustomError(tge, 'TGE_InvalidAddress()');
    });

    it("should revert if sale has not started", async function () {
      const {tge, account1} = this.fixture;
      await expect(
        tge.depositUsdbc(account1.address, ETH_IN_WEI)
      ).to.be.revertedWithCustomError(tge, 'TGE_SaleNotStarted()');
    });

    it.skip("should revert if sale has ended", async function () {
      const {tge, owner, account1} = this.fixture;
      await tge.connect(owner).allocateFXDX(ethers.utils.parseEther("1000"));
      await tge.connect(account1).depositUsdbc(addr1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleClose()).toNumber() + 1,
      ]);
      await expect(
        tge.depositUsdbc(account1.address, ETH_IN_WEI)
      ).to.be.revertedWith(tge, 'SaleEnded()');
    });

    it.skip("should deposit USDBC and update deposit and total deposited amount", async function () {
      const {tge, owner, account1} = this.fixture;
      await tge.connect(owner).allocateFXDX(ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleStart()).toNumber() + 1,
      ]);
      const usdbcBalanceBefore = await ethers.provider.getBalance(tge.target);
      await tge.connect(account1).depositUsdbc(account1.address, ETH_IN_WEI);
      const usdbcBalanceAfter = await ethers.provider.getBalance(tge.target);
      expect(usdbcBalanceAfter).to.be.gt(usdbcBalanceBefore);
      expect(await tge.deposits(addr1.address)).to.equal(
        ETH_IN_WEI
      );
      expect(await tge.usdbcDeposited()).to.equal(
        ETH_IN_WEI
      );
    });
  });

  describe("withdraw", function () {
    it("should revert if sale has not ended", async function () {
      const {tge, owner, account1} = this.fixture;
      await expect(tge.connect(owner).withdraw(account1.address)).to.be.
      revertedWithCustomError(tge, 'TGE_SaleHasNotEnded()');
    });

    it.skip("should revert if USDBC has already been withdrawn", async function () {
      await tge.connect(owner).allocateFXDX(ethers.utils.parseEther("1000"));
      await tge.connect(account1).depositUsdbc(account1.address, ethers.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleClose()).toNumber() + 1,
      ]);
      await tge.connect(owner).withdraw(account1.address);
      await expect(tge.connect(owner).withdraw(account1.address)).to.be.
      revertedWithCustomError(
        tge, 'TGE_AlreadyWithdraw()'
      );
    });

    it.skip("should withdraw USDBC to beneficiary", async function () {
      await tge.connect(owner).allocateFXDX(ethers.parseEther("1000"));
      await tge.connect(account1).depositUsdbc(addr1.address, ethers.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleClose()).toNumber() + 1,
      ]);
      const usdbcBalanceBefore = await ethers.provider.getBalance(tge.target);
      await tge.connect(owner).withdraw(account1.address);
      const usdbcBalanceAfter = await ethers.provider.getBalance(tge.target);
      expect(usdbcBalanceAfter).to.be.lt(usdbcBalanceBefore);
      expect(await ethers.provider.getBalance(account1.address)).to.be.gt(
        ethers.parseEther("0")
      );
    });
  });

  describe("claimFXDX", function () {
    it("should revert if sale has not ended", async function () {
      const {tge, owner, account1} = this.fixture;
      await expect(tge.connect(account1).claimFXDX()).to.be.revertedWithCustomError(
        tge, 'TGE_SaleHasNotEnded()'
      );
    });

    it.skip("should revert if already claimed", async function () {
      const {tge, owner, account1} = this.fixture;
      await tge.connect(owner).allocateFXDX(ethers.parseEther("1000"));
      await tge.connect(account1).depositUsdbc(account1.address, ethers.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleClose()).toNumber() + 1,
      ]);
      await tge.connect(account1).claimFXDX();
      await expect(tge.connect(account1).claimFXDX()).to.be.revertedWithCustomError(
        tge, 'TGE_AlreadyClaimed()'
      );
    });

    it.skip("should transfer FXDX to beneficiary and refund USDBC if applicable", async function () {
      const {tge, owner, account1} = this.fixture;
      await tge.connect(owner).allocateFXDX(ethers.parseEther("1000"));
      await tge.connect(account1).depositUsdbc(account1.address, ethers.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleClose()).toNumber() + 1,
      ]);
      const fxdxBalanceBefore = await ethers.provider.getBalance(tge.target);
      const usdbcBalanceBefore = await ethers.provider.getBalance(tge.target);
      await tge.connect(account1).claimFXDX();
      const fxdxBalanceAfter = await ethers.provider.getBalance(tge.target);
      const usdbcBalanceAfter = await ethers.provider.getBalance(tge.target);
      expect(fxdxBalanceAfter).to.be.lt(fxdxBalanceBefore);
      expect(await ethers.provider.getBalance(addr1.address)).to.be.gt(
        ethers.utils.parseEther("0")
      );
      expect(usdbcBalanceAfter).to.be.lt(usdbcBalanceBefore);
    });
  });

  describe("Get the right claimable amount", function () {

  });

  describe("Get the right refundable amount", function () {});

  describe("Allocate FXDX", function () {});

  describe("Update Uniswap Pool", function () {});
});