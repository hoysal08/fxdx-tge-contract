// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import { ethers } from "hardhat";
import { expect } from "chai";
import { TGE } from "../typechain/TGE";

describe("TGE", function () {
  let tge: TGE;

  beforeEach(async function () {
    const [owner] = await ethers.getSigners();
    const TGEFactory = await ethers.getContractFactory("TGE", owner);
    tge = (await TGEFactory.deploy()) as TGE;
    await tge.deployed();
  });

  it("should deposit ETH and USDBC", async function () {
    const [owner, beneficiary] = await ethers.getSigners();
    const usdbc = await ethers.getContractAt("IERC20Upgradeable", tge.usdbc());
    const usdbcBalanceBefore = await usdbc.balanceOf(tge.address);

    await beneficiary.sendTransaction({ to: tge.address, value: ethers.utils.parseEther("1") });
    await usdbc.connect(beneficiary).approve(tge.address, ethers.utils.parseEther("100"));
    await tge.connect(beneficiary).depositUsdbc(beneficiary.address, ethers.utils.parseEther("100"));

    const usdbcBalanceAfter = await usdbc.balanceOf(tge.address);
    expect(usdbcBalanceAfter.sub(usdbcBalanceBefore)).to.equal(ethers.utils.parseEther("100"));
    expect(await tge.deposits(beneficiary.address)).to.equal(ethers.utils.parseEther("1"));
    expect(await tge.usdbcDeposited()).to.equal(ethers.utils.parseEther("100"));
  });

  it("should allocate FXDX tokens", async function () {
    const [owner] = await ethers.getSigners();
    const fxdx = await ethers.getContractAt("IERC20Upgradeable", tge.fxdx());
    const fxdxAllocation = ethers.utils.parseEther("1000");
    await fxdx.connect(owner).approve(tge.address, fxdxAllocation);

    await tge.connect(owner).allocateFXDX(fxdxAllocation);
    expect(await fxdx.balanceOf(tge.address)).to.equal(fxdxAllocation);
    expect(await tge.fxdxTokensAllocated()).to.equal(fxdxAllocation.toUint128());
  });

  it("should claim FXDX tokens", async function () {
    const [owner, beneficiary] = await ethers.getSigners();
    const fxdx = await ethers.getContractAt("IERC20Upgradeable", tge.fxdx());
    const usdbc = await ethers.getContractAt("IERC20Upgradeable", tge.usdbc());
    const fxdxAllocation = ethers.utils.parseEther("1000");
    const usdbcAmount = ethers.utils.parseEther("100");
    await fxdx.connect(owner).approve(tge.address, fxdxAllocation);
    await usdbc.connect(beneficiary).approve(tge.address, usdbcAmount);

    await tge.connect(owner).allocateFXDX(fxdxAllocation);
    await tge.connect(beneficiary).depositUsdbc(beneficiary.address, usdbcAmount);
    await tge.connect(beneficiary).claimFXDX();

    expect(await fxdx.balanceOf(beneficiary.address)).to.equal(ethers.utils.parseEther("0.083333333333333333"));
    expect(await usdbc.balanceOf(beneficiary.address)).to.equal(ethers.utils.parseEther("99.916666666666666667"));
    expect(await tge.isClaimed(beneficiary.address)).to.equal(true);
  });
});