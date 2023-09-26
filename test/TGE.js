const { ethers,upgrades} = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { describe } = require("mocha");
require("@nomicfoundation/hardhat-chai-matchers");
const { expect } = require("chai");

const  AddressZero  = ethers.ZeroAddress

describe("TGE Contract", () => {
    async function deployFixture() {
        const [owner, account1, account2] = await ethers.getSigners();
        const START_TIMESTAMP = Date.now();
        const SALE_DURATION = 36 //In hours
        const END_TIMESTAMP = START_TIMESTAMP + (SALE_DURATION * 60 * 60 * 1000);
        const ETH_HARDCAP = '100' //In ETH
        

        const WETH = await ethers.getContractFactory("WETH", owner);
        const weth = await WETH.deploy();
        await weth.waitForDeployment();

        const FXDX = await ethers.getContractFactory("FXDX", owner);
        const fxdx = await FXDX.deploy();
        await fxdx.waitForDeployment();

        const TGE = await ethers.getContractFactory("TGE", owner);

        // const tge = await TGE.deploy(fxdx.address,START_TIMESTAMP,END_TIMESTAMP,ethers.parseEther(ETH_HARDCAP),weth.address,AddressZero);
       const  tge = await upgrades.deployProxy(TGE,[fxdx.target,START_TIMESTAMP,END_TIMESTAMP,ethers.parseEther(ETH_HARDCAP),weth.target,AddressZero])
        
        await tge.waitForDeployment();
        return { owner, account1, account2,weth,fxdx,tge };
    }

    describe("Check Contract initialisation", async () => {
        it("should have correct address of contract", async () => {
            const {owner, account1, account2,weth,fxdx,tge } = await loadFixture(deployFixture);
            
            expect(await tge.)
        })
    })
})