require("@nomicfoundation/hardhat-toolbox");
require("@openzeppelin/hardhat-upgrades");
/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.18",
  },
  networks: {
    hardhat: {
      chainId: 31337,
      forking: {
        url: "https://base.meowrpc.com",
      },
    },
  },
};