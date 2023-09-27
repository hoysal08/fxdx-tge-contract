const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TGE", function () {
  let TGE;
  let tge;
  let owner;
  let addr1;
  let addr2;

  beforeEach(async function () {
    TGE = await ethers.getContractFactory("TGE");
    [owner, addr1, addr2] = await ethers.getSigners();
    tge = await TGE.deploy();
    await tge.deployed();
  });

  describe("depositETH", function () {
    it("should revert if value is 0", async function () {
      await expect(
        tge.depositETH(addr1.address, ethers.utils.parseEther("0"), {
          value: ethers.utils.parseEther("0"),
        })
      ).to.be.revertedWith("TGE: Invalid value");
    });

    it("should revert if beneficiary is 0 address", async function () {
      await expect(
        tge.depositETH(ethers.constants.AddressZero, ethers.utils.parseEther("1"), {
          value: ethers.utils.parseEther("1"),
        })
      ).to.be.revertedWith("TGE: Invalid address");
    });

    it("should revert if beneficiary is contract address", async function () {
      await expect(
        tge.depositETH(tge.address, ethers.utils.parseEther("1"), {
          value: ethers.utils.parseEther("1"),
        })
      ).to.be.revertedWith("TGE: Invalid address");
    });

    it("should revert if sale has not started", async function () {
      await expect(
        tge.depositETH(addr1.address, ethers.utils.parseEther("1"), {
          value: ethers.utils.parseEther("1"),
        })
      ).to.be.revertedWith("TGE: Sale not started");
    });

    it("should revert if sale has ended", async function () {
      await tge.allocateFXDX(ethers.utils.parseEther("1000"));
      await tge.depositUsdbc(addr1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleClose()).toNumber() + 1,
      ]);
      await expect(
        tge.depositETH(addr1.address, ethers.utils.parseEther("1"), {
          value: ethers.utils.parseEther("1"),
        })
      ).to.be.revertedWith("TGE: Sale ended");
    });

    it("should deposit ETH and transfer USDBC to beneficiary", async function () {
      await tge.allocateFXDX(ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleStart()).toNumber() + 1,
      ]);
      const usdbcBalanceBefore = await ethers.provider.getBalance(tge.address);
      await tge.depositETH(addr1.address, ethers.utils.parseEther("1"), {
        value: ethers.utils.parseEther("1"),
      });
      const usdbcBalanceAfter = await ethers.provider.getBalance(tge.address);
      expect(usdbcBalanceAfter).to.be.gt(usdbcBalanceBefore);
      expect(await tge.deposits(addr1.address)).to.equal(
        ethers.utils.parseEther("1")
      );
    });
  });

  describe("depositUsdbc", function () {
    it("should revert if beneficiary is 0 address", async function () {
      await expect(
        tge.depositUsdbc(ethers.constants.AddressZero, ethers.utils.parseEther("1"))
      ).to.be.revertedWith("TGE: Invalid address");
    });

    it("should revert if beneficiary is contract address", async function () {
      await expect(
        tge.depositUsdbc(tge.address, ethers.utils.parseEther("1"))
      ).to.be.revertedWith("TGE: Invalid address");
    });

    it("should revert if sale has not started", async function () {
      await expect(
        tge.depositUsdbc(addr1.address, ethers.utils.parseEther("1"))
      ).to.be.revertedWith("TGE: Sale not started");
    });

    it("should revert if sale has ended", async function () {
      await tge.allocateFXDX(ethers.utils.parseEther("1000"));
      await tge.depositUsdbc(addr1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleClose()).toNumber() + 1,
      ]);
      await expect(
        tge.depositUsdbc(addr1.address, ethers.utils.parseEther("1"))
      ).to.be.revertedWith("TGE: Sale ended");
    });

    it("should deposit USDBC and update deposit and total deposited amount", async function () {
      await tge.allocateFXDX(ethers.utils.parseEther("1000"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleStart()).toNumber() + 1,
      ]);
      const usdbcBalanceBefore = await ethers.provider.getBalance(tge.address);
      await tge.depositUsdbc(addr1.address, ethers.utils.parseEther("1"));
      const usdbcBalanceAfter = await ethers.provider.getBalance(tge.address);
      expect(usdbcBalanceAfter).to.be.gt(usdbcBalanceBefore);
      expect(await tge.deposits(addr1.address)).to.equal(
        ethers.utils.parseEther("1")
      );
      expect(await tge.usdbcDeposited()).to.equal(
        ethers.utils.parseEther("1")
      );
    });
  });

  describe("withdraw", function () {
    it("should revert if sale has not ended", async function () {
      await expect(tge.withdraw(addr1.address)).to.be.revertedWith(
        "TGE: Sale has not ended"
      );
    });

    it("should revert if USDBC has already been withdrawn", async function () {
      await tge.allocateFXDX(ethers.utils.parseEther("1000"));
      await tge.depositUsdbc(addr1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleClose()).toNumber() + 1,
      ]);
      await tge.withdraw(addr1.address);
      await expect(tge.withdraw(addr1.address)).to.be.revertedWith(
        "TGE: Already withdrawn"
      );
    });

    it("should withdraw USDBC to beneficiary", async function () {
      await tge.allocateFXDX(ethers.utils.parseEther("1000"));
      await tge.depositUsdbc(addr1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleClose()).toNumber() + 1,
      ]);
      const usdbcBalanceBefore = await ethers.provider.getBalance(tge.address);
      await tge.withdraw(addr1.address);
      const usdbcBalanceAfter = await ethers.provider.getBalance(tge.address);
      expect(usdbcBalanceAfter).to.be.lt(usdbcBalanceBefore);
      expect(await ethers.provider.getBalance(addr1.address)).to.be.gt(
        ethers.utils.parseEther("0")
      );
    });
  });

  describe("claimFXDX", function () {
    it("should revert if sale has not ended", async function () {
      await expect(tge.claimFXDX()).to.be.revertedWith(
        "TGE: Sale has not ended"
      );
    });

    it("should revert if already claimed", async function () {
      await tge.allocateFXDX(ethers.utils.parseEther("1000"));
      await tge.depositUsdbc(addr1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleClose()).toNumber() + 1,
      ]);
      await tge.claimFXDX();
      await expect(tge.claimFXDX()).to.be.revertedWith(
        "TGE: Already claimed"
      );
    });

    it("should transfer FXDX to beneficiary and refund USDBC if applicable", async function () {
      await tge.allocateFXDX(ethers.utils.parseEther("1000"));
      await tge.depositUsdbc(addr1.address, ethers.utils.parseEther("100"));
      await ethers.provider.send("evm_setNextBlockTimestamp", [
        (await tge.saleClose()).toNumber() + 1,
      ]);
      const fxdxBalanceBefore = await ethers.provider.getBalance(tge.address);
      const usdbcBalanceBefore = await ethers.provider.getBalance(tge.address);
      await tge.claimFXDX();
      const fxdxBalanceAfter = await ethers.provider.getBalance(tge.address);
      const usdbcBalanceAfter = await ethers.provider.getBalance(tge.address);
      expect(fxdxBalanceAfter).to.be.lt(fxdxBalanceBefore);
      expect(await ethers.provider.getBalance(addr1.address)).to.be.gt(
        ethers.utils.parseEther("0")
      );
      expect(usdbcBalanceAfter).to.be.lt(usdbcBalanceBefore);
    });
  });
});