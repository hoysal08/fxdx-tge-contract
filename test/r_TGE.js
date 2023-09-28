const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { describe, it, beforeEach } = require("mocha");
require("@nomicfoundation/hardhat-chai-matchers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { toBigInt } = require("ethers");

const AddressZero = ethers.ZeroAddress;
const START_DELAY = 3600;
const START_TIMESTAMP = parseInt(Date.now() / 1000) + START_DELAY;
const SALE_DURATION = 36; // In hours
const END_TIMESTAMP = START_TIMESTAMP + SALE_DURATION * 60 * 60;
const ETH_HARDCAP = "10"; // In ETH
const ETH_HARDCAP_IN_WEI = ethers.parseEther(ETH_HARDCAP);
const LP_MINT_TOKENS = ethers.parseEther("1000");

describe("TGE Contract", () => {
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
   // await allocateFXDX(fxdx, owner, tge);
    //await time.increase(START_DELAY);
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

  beforeEach(async () => {
    this.fixture = await loadFixture(deployFixture);
  });

  it("Should allowance", async () => {
    const { owner, fxdx, tge, LP_MINT_TOKENS } = this.fixture;
    await allocateFXDX(fxdx, owner, tge);
  });

  it("Should deposit ETH", async () => {
    const { owner, fxdx, tge, account1 } = this.fixture;
    await depositETH(account1, 0, fxdx, tge, owner);
  });
});
