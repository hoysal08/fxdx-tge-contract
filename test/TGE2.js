const { ethers, upgrades } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { describe } = require("mocha");
require("@nomicfoundation/hardhat-chai-matchers");
const { expect } = require("chai");
const { time } = require("@nomicfoundation/hardhat-network-helpers");


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

const V3_SWAP_ROUTER = "0x2626664c2603336E57B271c5C0b26F421741e481"
const BASE_USDBC = "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA"
const BASE_WETH = "0x4200000000000000000000000000000000000006"


describe("TGE Contract", () => {
    async function deployFixture() {
        const [owner, account1, account2] = await ethers.getSigners();
        // const WETH = await ethers.getContractFactory("WETH", owner);
        // const weth = await WETH.deploy();
        // await weth.waitForDeployment();

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
})