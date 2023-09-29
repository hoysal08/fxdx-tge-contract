const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { describe, it, beforeEach } = require("mocha");
require("@nomicfoundation/hardhat-chai-matchers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const abii = require("../USDCBAse.json");
const abi = abii.abi;

const AddressZero = ethers.ZeroAddress;
const ETH_IN_WEI = ethers.parseEther("1");
const START_DELAY = 3600;
const START_TIMESTAMP = parseInt(Date.now() / 1000) + START_DELAY;
const SALE_DURATION = 2; // In hours
const END_TIMESTAMP = START_TIMESTAMP + SALE_DURATION * 60 * 60;
const USDC_HARDCAP = 600000; // In ETH
const USDC_DECIMAL = 6;
const POOLFEE = 500;
const PRICE = 12;
const PRICE_MULTIPLE = 10000;
const USDBC_HARDCAP_IN_DECIMAL = BigInt(USDC_HARDCAP * (10 ** USDC_DECIMAL));
const FXDX_LP_MINT = USDC_HARDCAP * (PRICE / PRICE_MULTIPLE)

const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const USDC_ADDRESS = "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca";
const BASE_SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481"
const ETH_DEPOSIT = true;

const timeInSeconds = 17300;
const timeHex = "0x" + timeInSeconds.toString(16);
const timeInSecondsStart = 7300;
const timeHexStart = "0x" + timeInSecondsStart.toString(16);

describe("TGE", function () {

  async function deployFixture() {
    const [owner, account1, account2] = await ethers.getSigners();

    const FXDX = await ethers.getContractFactory("FXDX", owner);
    const fxdx = await FXDX.deploy();
    await fxdx.waitForDeployment();

    const TGE = await ethers.getContractFactory("TGE", owner);
    const tge = await upgrades.deployProxy(TGE, { initializer: false });
    await allocateFXDX(fxdx, owner, tge);
    await tge
      .connect(owner)
      .updateUniswapPool(POOLFEE, BASE_SWAP_ROUTER);
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
    await tge.waitForDeployment();
    const usdc = await ethers.getContractAt(
      abi,
      USDC_ADDRESS,
      beneficiary
    );
    return {
      owner,
      account1,
      account2,
      fxdx,
      tge,
      usdc
    };
  }

  async function allocateFXDX(fxdx, owner, tge) {
    fxdx.connect(owner).mint(owner.address, FXDX_LP_MINT);
    fxdx.connect(owner).approve(tge.target, FXDX_LP_MINT);
    await expect(tge.connect(owner).allocateFXDX(FXDX_LP_MINT)).to.emit(
      tge,
      "AllocateFXDX"
    );
  }

  async function depositETH(beneficiary, minOutUSD, tge, owner) {
    const tgeWithSigner = tge.connect(beneficiary);
    const amountInWei = ethers.parseEther("1");
    await tgeWithSigner
      .connect(beneficiary)
      .depositETH(beneficiary, minOutUSD, {
        value: amountInWei,
        from: beneficiary,
      })

    await tge.usdbcDeposited();
  }

  async function mintUSDC(beneficiary, amount) {
    const bridge = "0x4200000000000000000000000000000000000010";
    const addressTo = beneficiary;

    const impersonatedSigner = await ethers.getImpersonatedSigner(bridge);
    await network.provider.send("hardhat_setBalance", [
      bridge,
      ethers.parseEther("1"),
    ]);
    const signer = await ethers.getSigner(bridge);
    const usdc = await ethers.getContractAt(
      abi,
      USDC_ADDRESS,
      signer
    );
    await usdc.connect(impersonatedSigner).mint(addressTo, amount)

  }

  async function depositUsdbc(beneficiary, amount, tge, usdc) {

    await mintUSDC(beneficiary, amount);
    await usdc.connect(beneficiary).approve(tge.target, amount);
    await tge.connect(beneficiary).depositUsdbc(beneficiary, amount)
  }

  beforeEach(async function () {
    this.fixture = await loadFixture(deployFixture);
  })

  describe("Contract Initialized Correctly", function () {
    it("should have correct address of contract", async function () {
      const { owner, fxdx, tge, START_TIMESTAMP, END_TIMESTAMP, ETH_HARDCAP_IN_WEI } = this.fixture;
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
      const { tge, account1 } = this.fixture;
      await expect(
        tge.connect(account1).depositETH(account1.address, ethers.parseEther("0"), {
          value: ethers.parseEther("0"),
        })
      ).to.be.revertedWithCustomError(tge, 'InvalidValue()');
    });

    // Reverting if the beneficiary is 0 address
    it("should revert if beneficiary is 0 address", async function () {
      const { tge, account1 } = this.fixture;
      await expect(
        tge.connect(account1).depositETH(AddressZero, ETH_IN_WEI, {
          value: ETH_IN_WEI,
        })
      ).to.be.revertedWithCustomError(tge, 'InvalidAddress()');
    });

    // Reverting if the beneficiary is contract address
    it("should revert if beneficiary is contract address", async function () {
      const { tge, owner } = this.fixture;
      await expect(
        tge.connect(owner).depositETH(tge.target, ETH_IN_WEI, {
          value: ETH_IN_WEI,
        })
      ).to.be.revertedWithCustomError(tge, 'InvalidAddress()');
    });

    // Reverting if the sale has not started
    it("should revert if sale has not started", async function () {
      const { tge, account1 } = this.fixture;
      await expect(
        tge.connect(account1).depositETH(account1.address, ETH_IN_WEI, {
          value: ETH_IN_WEI,
        })
      ).to.be.revertedWithCustomError(tge, 'SaleNotStarted()');
    });

    // Reverting if the sale has ended
    it("should revert if sale has ended", async function () {
      const { tge, owner, account1 } = this.fixture;
      await time.increase(timeHex);
      await expect(
        tge.connect(account1).depositETH(account1.address, ETH_IN_WEI, {
          value: ETH_IN_WEI,
          from: account1.address,
        })
      ).to.be.revertedWithCustomError(tge, 'SaleEnded()');
    });

    //Deposit ETH and transfer USDBC to beneficiary
    it("should deposit ETH and transfer USDBC to beneficiary", async function () {
      const { tge, fxdx, owner, account1 } = this.fixture;
      const usdc = await ethers.getContractAt(
        abi,
        "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        account1
      );
      time.increase(timeHexStart);
      const usdbcBalanceBefore = await usdc.balanceOf(tge.target);
      await depositETH(account1, 0, fxdx, tge, owner)
      const usdbcBalanceAfter = await usdc.balanceOf(tge.target);
      expect(usdbcBalanceAfter).to.be.gt(usdbcBalanceBefore);
      // expect(await tge.connect(account1).deposits(account1.address)).to.equal(
      //   ETH_IN_WEI
      // );
    });
  });

  describe("depositUsdbc", function () {

    //If the address is 0 address 
    it("should revert if beneficiary is 0 address", async function () {
      const { tge, account1 } = this.fixture;
      await expect(
        tge.connect(account1).depositUsdbc(AddressZero, ETH_IN_WEI)
      ).to.be.revertedWithCustomError(tge, 'InvalidAddress()');
    });

    it("should revert if beneficiary is contract address", async function () {
      const { tge, account1 } = this.fixture;
      await expect(
        tge.connect(account1).depositUsdbc(tge.target, ETH_IN_WEI)
      ).to.be.revertedWithCustomError(tge, 'InvalidAddress()');
    });

    it("should revert if sale has not started", async function () {
      const { tge, account1 } = this.fixture;
      await expect(
        tge.depositUsdbc(account1.address, ETH_IN_WEI)
      ).to.be.revertedWithCustomError(tge, 'SaleNotStarted()');
    });

    it("should revert if sale has ended", async function () {
      const { tge, account1 } = this.fixture;
      await time.increase(timeHex);
      await expect(
        tge.connect(account1).depositUsdbc(account1.address, ETH_IN_WEI)
      ).to.be.revertedWithCustomError(tge, 'SaleEnded()');
    });

    it("should deposit USDBC and update deposit and total deposited amount", async function () {
      const { tge, owner, account1 } = this.fixture;
      const usdc = await ethers.getContractAt(
        abi,
        "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        account1
      );
      time.increase(timeHexStart);
      const usdbcBalanceBefore = await usdc.balanceOf(tge.target);
      await depositUsdbc(account1, 10, tge);
      const usdbcBalanceAfter = await usdc.balanceOf(tge.target);
      expect(usdbcBalanceAfter).to.be.gt(usdbcBalanceBefore);
      // expect(await tge.deposits(addr1.address)).to.equal(
      //   ETH_IN_WEI
      // );
      expect(await tge.usdbcDeposited()).to.equal(
        10
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
      const { tge, owner, account1 } = this.fixture;
      time.increase(timeHexStart);
      await depositUsdbc(account1, 10, tge);
      time.increase(timeHex);
      await tge.connect(owner).withdraw(account1.address);
      await expect(tge.connect(owner).withdraw(account1.address)).to.be.
        revertedWithCustomError(
          tge, 'AlreadyWithdraw()'
        );
    });

    it("should withdraw USDBC to beneficiary", async function () {
      const { tge, owner, account1 } = this.fixture;
      const usdc = await ethers.getContractAt(
        abi,
        "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        account1
      );
      time.increase(timeHexStart);
      await depositUsdbc(account1, 10, tge);
      time.increase(timeHex);
      const usdbcBalanceBefore = await usdc.balanceOf(account1.address);
      await tge.connect(owner).withdraw(account1.address);
      const usdbcBalanceAfter = await usdc.balanceOf(account1.address);
      expect(usdbcBalanceAfter).to.be.gt(usdbcBalanceBefore);
    });
  });

  describe("claimFXDX", function () {
    it("should revert if sale has not ended", async function () {
      const { tge, owner, account1 } = this.fixture;
      time.increase(timeHexStart);
      await expect(tge.connect(account1).claimFXDX()).to.be.revertedWithCustomError(
        tge, 'SaleHasNotEnded()'
      );
    });

    it("should revert if already claimed", async function () {
      const { tge, account1 } = this.fixture;

      time.increase(timeHexStart);
      await depositUsdbc(account1, 10, tge);
      await time.increase(timeHex);

      await tge.connect(account1).claimFXDX();
      await expect(tge.connect(account1).claimFXDX()).to.be.revertedWithCustomError(
        tge, 'AlreadyClaimed()'
      );
    });

    it("should transfer FXDX to beneficiary and refund USDBC if applicable", async function () {
      const { tge, fxdx, owner, account1 } = this.fixture;
      const usdc = await ethers.getContractAt(
        abi,
        "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA",
        account1
      );
      time.increase(timeHexStart)
      await depositUsdbc(account1, 10, tge);
      time.increase(timeHex);
      const fxdxBalanceBefore = await fxdx.balanceOf(account1.address);
      await expect(tge.connect(account1).claimFXDX()).to.emit(tge, "ClaimFXDX");
      const fxdxBalanceAfter = await fxdx.balanceOf(account1.address);
      // expect(fxdxBalanceAfter).to.be.gt(fxdxBalanceBefore);

    });
  });

  describe("Get the right claimable amount", function () {

  });

  describe("Get the right refundable amount", function () { });

  describe("Allocate FXDX", function () { });

  describe("Update Uniswap Pool", function () { });
});