# Sample Hardhat Project

This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a script that deploys that contract.

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat run scripts/deploy.js
```



The core functionality of the contract is to take ETH or USDBC from the user and give them FXDX after sale has ended at the price of 1 FXDX = $0.12.
We use uniswap V3 router to convert ETH-> USDBC so the contract always holds only USDBC.


initialize aurgumnents

->_poolfee is with price precisison 10,000 (0.05%->500)
->_usdbcHardCap is with decimal of 6 (100usdbc -> 100 * 10**6)
