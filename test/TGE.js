const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { describe, it, beforeEach } = require("mocha");
require("@nomicfoundation/hardhat-chai-matchers");
const { expect } = require("chai");
const { time, setBalance } = require("@nomicfoundation/hardhat-network-helpers");
const abii = require("../USDCBAse.json");
const abi = abii.abi;

const AddressZero = ethers.ZeroAddress;
const ETH_IN_WEI = ethers.parseEther("1");
const START_DELAY = 3600;
const START_TIMESTAMP = parseInt(Date.now() / 1000) + START_DELAY;
const SALE_DURATION = 2; // In hours
const END_TIMESTAMP = START_TIMESTAMP + SALE_DURATION * 60 * 60;
const USDC_HARDCAP = 600000;
const USDC_DECIMAL = 6;
const POOLFEE = 500;
const PRICE = 12;
const DOLLOR_IN_CENTS = 100;
const PRICE_PRECISION = BigInt(10 ** 18);
const USDBC_HARDCAP_IN_DECIMAL = (USDC_HARDCAP * (10 ** USDC_DECIMAL));
const FXDX_LP_MINT = (BigInt(USDBC_HARDCAP_IN_DECIMAL) * (BigInt(DOLLOR_IN_CENTS) * PRICE_PRECISION) / BigInt(PRICE)) / (BigInt(10 ** USDC_DECIMAL));
const USDC_100 = (100 * (10 ** USDC_DECIMAL))


const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const USDC_ADDRESS = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA";
const BASE_SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481"
const ETH_DEPOSIT = true;

// const timeInSeconds = 17300;
// const startDelayHex = "0x" + START_DELAY.toString(16);
// const timeInSecondsStart = 7300;
// const timeHexStart = "0x" + timeInSecondsStart.toString(16);

describe("TGE", function () {

  async function deployFixture() {
    const [owner, account1, account2] = await ethers.getSigners();

    const FXDX = await ethers.getContractFactory("FXDX", owner);
    const fxdx = await FXDX.deploy();
    await fxdx.waitForDeployment();


    const TGE = await ethers.getContractFactory("TGE", owner);
    const tge = await upgrades.deployProxy(TGE, { initializer: false });
    await tge.waitForDeployment();
    await tge
      .connect(owner)
      .initialize(
        START_TIMESTAMP,
        END_TIMESTAMP,
        USDBC_HARDCAP_IN_DECIMAL,
        POOLFEE,
        fxdx.target,
        USDC_ADDRESS,
        WETH_ADDRESS,
        BASE_SWAP_ROUTER,
        ETH_DEPOSIT
      );

    await tge
      .connect(owner)
      .updateUniswapPool(POOLFEE, BASE_SWAP_ROUTER);

    await allocateFXDX(fxdx, owner, tge);

    const usdbc = await ethers.getContractAt(
      abi,
      USDC_ADDRESS,
    );
    return {
      owner,
      account1,
      account2,
      fxdx,
      tge,
      usdbc
    };
  }

  async function allocateFXDX(fxdx, owner, tge) {
    fxdx.connect(owner).mint(owner.address, FXDX_LP_MINT);
    fxdx.connect(owner).approve(tge.target, FXDX_LP_MINT);
    await tge.connect(owner).allocateFXDX(FXDX_LP_MINT)
  }

  async function depositETH(beneficiary, minOutUSD, tge) {
    const tgeWithSigner = tge.connect(beneficiary);
    const amountInWei = ethers.parseEther("1");
    await tgeWithSigner
      .connect(beneficiary)
      .depositETH(beneficiary.address, minOutUSD, {
        value: amountInWei,
      })
  }

  async function mintUSDC(beneficiary, amount) {
    const bridge = "0x4200000000000000000000000000000000000010";
    const addressTo = beneficiary;

    const impersonatedSigner = await ethers.getImpersonatedSigner(bridge);
    await setBalance(bridge, ethers.parseEther("1"))

    const signer = await ethers.getSigner(bridge);
    const usdc = await ethers.getContractAt(
      abi,
      USDC_ADDRESS,
      signer
    );
    await usdc.connect(impersonatedSigner).mint(addressTo, amount)

  }

  async function depositUsdbc(beneficiary, amount, tge, usdbc) {

    await mintUSDC(beneficiary, amount);
    await usdbc.connect(beneficiary).approve(tge.target, amount);
    await tge.connect(beneficiary).depositUsdbc(beneficiary, amount)
  }

  beforeEach(async function () {
    this.fixture = await loadFixture(deployFixture);
  })

  describe("Contract Initialized Correctly", function () {
    it("should have correct address of contract", async function () {
      const { owner,
        account1,
        account2,
        fxdx,
        tge,
        usdbc } = this.fixture;
      expect(await tge.saleStart()).to.be.equal(START_TIMESTAMP);
      expect(await tge.saleClose()).to.be.equal(END_TIMESTAMP);
      expect(await tge.usdbcHardCap()).to.be.equal(USDBC_HARDCAP_IN_DECIMAL);
      expect(await tge.poolFee()).to.be.equal(POOLFEE);
      expect(await tge.fxdx()).to.be.equal(fxdx.target)
      expect(await tge.usdbc()).to.be.equal(USDC_ADDRESS);
      expect(await tge.weth()).to.be.equal(WETH_ADDRESS);
      expect(await tge.v3SwapRouter()).to.be.equal(BASE_SWAP_ROUTER);
      expect(await tge.owner()).to.be.equal(owner.address);
      expect(await tge.usdbcWithdrawn()).to.be.equal(false);
      expect(await tge.dollorInCents()).to.be.equal(DOLLOR_IN_CENTS);
      expect(await tge.price()).to.be.equal(PRICE);
      expect(await tge.pricePrecision()).to.be.equal(PRICE_PRECISION);
    });
  })

  describe("depositETH", function () {
    it("should revert if value is 0", async function () {
      const { tge, account1 } = this.fixture;
      await expect(
        tge.connect(account1).depositETH(account1.address, ethers.parseEther("0"), {
          value: ethers.parseEther("0"),
        })
      ).to.be.revertedWithCustomError(tge, 'InvalidValue()');
    });

    it("should revert if beneficiary is 0 address", async function () {
      const { tge, account1 } = this.fixture;
      await expect(
        tge.connect(account1).depositETH(AddressZero, ETH_IN_WEI, {
          value: ETH_IN_WEI,
        })
      ).to.be.revertedWithCustomError(tge, 'InvalidAddress()');
    });


    it("should revert if beneficiary is contract address", async function () {
      const { tge, owner } = this.fixture;
      await expect(
        tge.connect(owner).depositETH(tge.target, ETH_IN_WEI, {
          value: ETH_IN_WEI,
        })
      ).to.be.revertedWithCustomError(tge, 'InvalidAddress()');
    });


    it("should revert if sale has not started", async function () {
      const { tge, account1 } = this.fixture;
      await expect(
        tge.connect(account1).depositETH(account1.address, ETH_IN_WEI, {
          value: ETH_IN_WEI,
        })
      ).to.be.revertedWithCustomError(tge, 'SaleNotStarted()');
    });

    it("should revert if sale has ended", async function () {
      const { tge, owner, account1 } = this.fixture;
      await time.increase(END_TIMESTAMP + 1);
      await expect(
        tge.connect(account1).depositETH(account1.address, ETH_IN_WEI, {
          value: ETH_IN_WEI,
          from: account1.address,
        })
      ).to.be.revertedWithCustomError(tge, 'SaleEnded()');
    });


    it("should deposit ETH and get usdbc from uniswap", async function () {
      const { tge, fxdx, owner, account1, usdbc } = this.fixture;

      time.increaseTo(START_TIMESTAMP)
      const usdbcBalanceBefore = await usdbc.balanceOf(tge.target);
      await depositETH(account1, 0, tge)
      const usdbcBalanceAfter = await usdbc.balanceOf(tge.target);
      expect(usdbcBalanceAfter).to.be.gt(usdbcBalanceBefore);
      expect(await tge.connect(account1).depositsInETH(account1.address)).to.equal(
        ETH_IN_WEI
      );
    });
  });

  describe("depositUsdbc", function () {

    //   //If the address is 0 address 
    it("should revert if beneficiary is 0 address", async function () {
      const { tge, account1 } = this.fixture;
      await expect(
        tge.connect(account1).depositUsdbc(AddressZero, USDC_100)
      ).to.be.revertedWithCustomError(tge, 'InvalidAddress()');
    });

    it("should revert if beneficiary is contract address", async function () {
      const { tge, account1 } = this.fixture;
      await expect(
        tge.connect(account1).depositUsdbc(tge.target, USDC_100)
      ).to.be.revertedWithCustomError(tge, 'InvalidAddress()');
    });

    it("should revert if sale has not started", async function () {
      const { tge, account1 } = this.fixture;
      await expect(
        tge.depositUsdbc(account1.address, USDC_100)
      ).to.be.revertedWithCustomError(tge, 'SaleNotStarted()');
    });

    it("should revert if sale has ended", async function () {
      const { tge, account1 } = this.fixture;
      await time.increaseTo(END_TIMESTAMP + 1);
      await expect(
        tge.connect(account1).depositUsdbc(account1.address, USDC_100)
      ).to.be.revertedWithCustomError(tge, 'SaleEnded()');
    });

    it("should deposit USDBC and update deposit and total deposited amount", async function () {
      const { tge, owner, account1, usdbc } = this.fixture;
      time.increaseTo(START_TIMESTAMP);
      const usdbcBalanceBefore = await usdbc.balanceOf(tge.target);

      await depositUsdbc(account1, USDC_100, tge, usdbc);
      const usdbcBalanceAfter = await usdbc.balanceOf(tge.target);

      expect(usdbcBalanceAfter).to.be.gt(usdbcBalanceBefore);
      expect(await tge.deposits(account1.address)).to.equal(
        USDC_100
      );
      expect(await tge.usdbcDeposited()).to.equal(
        USDC_100
      );
    });
  });

  describe("withdraw", function () {
    it("should revert if sale has not ended", async function () {
      const { tge, owner, account1 } = this.fixture;
      await expect(tge.connect(owner).withdraw(account1.address)).to.be.
        revertedWithCustomError(tge, 'SaleHasNotEnded()');
    });

    it("should revert if USDBC has already been withdrawn", async function () {
      const { tge, owner, account1, usdbc } = this.fixture;
      time.increaseTo(START_TIMESTAMP);
      await depositUsdbc(account1, USDC_100, tge, usdbc);
      time.increaseTo(END_TIMESTAMP + 1);
      await tge.connect(owner).withdraw(owner.address);
      await expect(tge.connect(owner).withdraw(owner.address)).to.be.
        revertedWithCustomError(
          tge, 'AlreadyWithdraw()'
        );
    });

    it("should withdraw USDBC to beneficiary", async function () {
      const { tge, owner, account1, usdbc } = this.fixture;

      time.increaseTo(START_TIMESTAMP);
      await depositUsdbc(account1, USDC_100, tge, usdbc);
      time.increaseTo(END_TIMESTAMP);
      const usdbcBalanceBefore = await usdbc.balanceOf(owner.address);
      await tge.connect(owner).withdraw(owner.address);
      const usdbcBalanceAfter = await usdbc.balanceOf(owner.address);
      expect(usdbcBalanceAfter).to.be.gt(usdbcBalanceBefore);
    });
  });

  describe("claimFXDX", function () {
    it("should revert if sale has not ended", async function () {
      const { tge, owner, account1 } = this.fixture;
      time.increaseTo(START_TIMESTAMP);
      await expect(tge.connect(account1).claimFXDX()).to.be.revertedWithCustomError(
        tge, 'SaleHasNotEnded()'
      );
    });

    it("should revert if already claimed", async function () {
      const { tge, account1, usdbc } = this.fixture;

      time.increaseTo(START_TIMESTAMP);
      await depositUsdbc(account1, USDC_100, tge, usdbc);
      await time.increase(END_TIMESTAMP);
      await tge.connect(account1).claimFXDX();
      await expect(tge.connect(account1).claimFXDX()).to.be.revertedWithCustomError(
        tge, 'AlreadyClaimed()'
      );
    });

    it("should transfer FXDX to beneficiary and refund USDBC if applicable", async function () {
      const { tge, fxdx, owner, account1, usdbc } = this.fixture;

      time.increaseTo(START_TIMESTAMP)
      await depositUsdbc(account1, USDC_100, tge, usdbc);
      time.increaseTo(END_TIMESTAMP);
      const fxdxBalanceBefore = await fxdx.balanceOf(account1.address);
      const usdbcBalanceBefore = await usdbc.balanceOf(account1.address);
      await expect(tge.connect(account1).claimFXDX()).to.emit(tge, "ClaimFXDX");
      const usdbcBalanceAfter = await usdbc.balanceOf(account1.address);
      const fxdxBalanceAfter = await fxdx.balanceOf(account1.address);
      expect(fxdxBalanceAfter).to.be.gt(fxdxBalanceBefore);
      expect(usdbcBalanceBefore).to.be.equal(usdbcBalanceAfter)
    });
    
    // it("should transfer FXDX to beneficiary and refund USDBC when overflow", async function () {
    //   const { tge, fxdx, owner, account1,account2, usdbc } = this.fixture;

    //   time.increaseTo(START_TIMESTAMP)
    //   await depositUsdbc(account1, (200000 * (10** USDC_DECIMAL)), tge, usdbc); 
    //   await depositUsdbc(account2, (700000 * (10**USDC_DECIMAL)), tge, usdbc); 
    //   time.increaseTo(END_TIMESTAMP);
    //   // const fxdxBalanceBefore = await fxdx.balanceOf(account1.address);
    //   // const usdbcBalanceBefore = await usdbc.balanceOf(account1.address);
    //   await expect(tge.connect(account2).claimFXDX()).to.emit(tge, "ClaimFXDX");
    //   // const usdbcBalanceAfter = await usdbc.balanceOf(account1.address);
    //   // const fxdxBalanceAfter = await fxdx.balanceOf(account1.address);
    //   // expect(fxdxBalanceAfter).to.be.gt(fxdxBalanceBefore);
    //   // expect(usdbcBalanceBefore).to.be.lt(usdbcBalanceAfter)
    // });
  });
});