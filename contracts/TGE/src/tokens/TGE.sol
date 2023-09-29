// SPDX-License-Identifier: BUSL-1.1
// This code is made available under the terms and conditions of the Business Source License 1.1 (BUSL-1.1).
// The act of publishing this code is driven by the aim to promote transparency and facilitate its utilization for educational purposes.

pragma solidity 0.8.18;

import "hardhat/console.sol";
import "../../src/staking/interfaces/IUniswapV3Pool.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import "../../lib/openzeppelin-contracts-upgradeable/contracts/access/OwnableUpgradeable.sol";
import "../../lib/openzeppelin-contracts-upgradeable/contracts/token/ERC20/IERC20Upgradeable.sol";
import "../../lib/openzeppelin-contracts-upgradeable/contracts/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "../../lib/openzeppelin-contracts-upgradeable/contracts/utils/math/MathUpgradeable.sol";
import "../../lib/openzeppelin-contracts-upgradeable/contracts/security/ReentrancyGuardUpgradeable.sol";
import "../../lib/openzeppelin-contracts-upgradeable/contracts/utils/math/SafeCastUpgradeable.sol";
import "../interfaces/IWNative.sol";

contract TGE is OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using MathUpgradeable for uint256;
    using SafeCastUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    event TokenDeposit(
        address indexed purchaser,
        address indexed beneficiary,
        uint256 value
    );
    event Withdraw(uint256 amount);
    event AllocateFXDX(uint256 amount);
    event ClaimFXDX(address claimer, uint256 fxdxAmount, uint256 refundAmount);

    error InvalidSaleStart();
    error InvalidSaleClose();
    error SaleNotStarted();
    error SaleHasStarted();
    error SaleEnded();
    error MaxDepositReached();
    error InvalidAddress();
    error TransferEthFailed();
    error AlreadyClaimed();
    error InvalidValue();
    error SaleHasNotEnded();
    error AlreadyWithdraw();
    error PoolHasNotSet();
    error ETHDisabled();

    address public fxdx;
    uint256 public fxdxTokensAllocated; // FXDX Tokens allocated to this contract
    uint128 public usdbcDeposited; // Keeps track of USDBC deposited
    uint64 public saleStart; // Time when the token sale starts
    uint64 public saleClose; // Time when the token sale ends
    uint192 public usdbcHardCap; // Hard Cap for USDBC to be collected from this TGE
    bool public usdbcWithdrawn; // Flag that says if the owner of this contract has withdrawn the ETH raised by this TGE event
    bool public ethDeposit;
    address public usdbc;
    address public weth;
    address public v3SwapRouter;
    mapping(address => uint256) public deposits; // Amount each user deposited
    mapping(address => uint256) public depositsInETH; // ETH each user deposited
    mapping(address => bool) public isClaimed; // Keep track if user has already claimed FXDX

    uint price;
    uint pricePrecision;
    uint24 public poolFee;
    uint8 dollorInCents;

    /// @param _saleStart time when the token sale starts
    /// @param _saleClose time when the token sale closes
    function initialize(
        uint64 _saleStart,
        uint64 _saleClose,
        uint192 _usdbcHardCap,
        uint8 _poolFee,
        address _fxdx,
        address _usdbc,
        address _weth,
        address _v3SwapRouter,
        bool _ethDeposit
    ) external initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

        if (_saleStart <= block.timestamp) revert InvalidSaleStart();
        if (_saleClose <= _saleStart) revert InvalidSaleClose();

        fxdx = _fxdx;
        saleStart = _saleStart;
        saleClose = _saleClose;
        usdbcHardCap = _usdbcHardCap;
        usdbc = _usdbc;
        weth = _weth;
        v3SwapRouter = _v3SwapRouter;
        usdbcWithdrawn = false;
        poolFee = _poolFee;
        ethDeposit = _ethDeposit;
        dollorInCents = 100;
        price = 12;
        pricePrecision = 10 ** 18;
    }

    /// Deposit fallback
    receive() external payable nonReentrant {}

    /// Deposit
    /// @param beneficiary will be able to claim tokens after saleClose
    /// @dev must be equivalent to receive()
    function depositETH(
        address beneficiary,
        uint minOutUSD
    ) external payable nonReentrant {
        if (!ethDeposit) revert ETHDisabled();
        if (msg.value == 0) revert InvalidValue();
        if (beneficiary == address(0) || beneficiary == address(this))
            revert InvalidAddress();
        if (block.timestamp < saleStart) revert SaleNotStarted();
        if (block.timestamp > saleClose) revert SaleEnded();

        depositsInETH[msg.sender] = msg.value;
        uint amountOut = swapETHtoUSDBC(minOutUSD);
        _deposit(beneficiary, amountOut);
    }

    function depositUsdbc(address beneficiary, uint256 _amount) external {
        if (beneficiary == address(0) || beneficiary == address(this))
            revert InvalidAddress();
        if (block.timestamp < saleStart) revert SaleNotStarted();
        if (block.timestamp > saleClose) revert SaleEnded();
        if (_amount == 0) revert InvalidValue();
        IERC20Upgradeable(usdbc).transferFrom(
            beneficiary,
            address(this),
            _amount
        );
        _deposit(beneficiary, _amount);
    }

    function swapETHtoUSDBC(
        uint256 minAmountOut
    ) internal returns (uint256 amountOut) {
        IWNative(weth).deposit{value: msg.value}();
        IWNative(weth).approve(v3SwapRouter, msg.value);
        IV3SwapRouter.ExactInputSingleParams memory params = IV3SwapRouter
            .ExactInputSingleParams({
                tokenIn: weth,
                tokenOut: usdbc,
                fee: poolFee,
                recipient: address(this),
                amountIn: msg.value,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            });

        amountOut = IV3SwapRouter(v3SwapRouter).exactInputSingle(params);
    }

    function _deposit(address beneficiary, uint256 _amount) internal {
        deposits[beneficiary] = deposits[beneficiary] + _amount;
        usdbcDeposited = usdbcDeposited + _amount.toUint128();
        emit TokenDeposit(msg.sender, beneficiary, _amount);
    }

    /// @dev Withdraws eth deposited into the contract. Only owner can call this.
    function withdraw(address to) external onlyOwner {
        if (block.timestamp <= saleClose) revert SaleHasNotEnded();
        if (usdbcWithdrawn) revert AlreadyWithdraw();
        uint256 usdbctoWithdrawn = usdbcDeposited >= usdbcHardCap
            ? usdbcHardCap
            : usdbcDeposited;
        usdbcWithdrawn = true;
        _transferOutUsdbc(to, usdbctoWithdrawn);

        emit Withdraw(usdbctoWithdrawn);
    }

    function claimFXDX() external nonReentrant {
        if (block.timestamp <= saleClose) revert SaleHasNotEnded();
        if (isClaimed[msg.sender]) revert AlreadyClaimed();
        uint256 _claimableAmount = claimableAmount(msg.sender);
        uint256 _refundAmount = refundAmount(msg.sender);
        isClaimed[msg.sender] = true;

        if (_claimableAmount > 0)
            IERC20Upgradeable(fxdx).safeTransfer(msg.sender, _claimableAmount);
        if (_refundAmount > 0) {
            _transferOutUsdbc(msg.sender, _refundAmount);
        }
        emit ClaimFXDX(msg.sender, _claimableAmount, _refundAmount);
    }

    // function claimableAmount(address beneficiary) public view returns (uint256) {
    //   return
    //     !isClaimed[beneficiary] && usdbcDeposited > 0
    //       ? (deposits[beneficiary] * (dollorInCents / price)) / pricePrecision
    //       : 0;
    // }

    function claimableAmount(
        address beneficiary
    ) public view returns (uint256) {
        return
            !isClaimed[beneficiary] && usdbcDeposited > 0
                ? (deposits[beneficiary] *
                    ((dollorInCents * pricePrecision) / price)) / (10 ** 6)
                : 0;
    }

    function refundAmount(address beneficiary) public view returns (uint256) {
        if (isClaimed[beneficiary]) return 0;
        if (usdbcDeposited <= usdbcHardCap) return 0;
        return
            deposits[beneficiary] -
            (usdbcHardCap * deposits[beneficiary]) /
            usdbcDeposited;
    }

    function allocateFXDX(uint256 _fxdxAllocation) external onlyOwner {
        if (block.timestamp > saleStart) revert SaleHasStarted();
        IERC20Upgradeable(fxdx).safeTransfer(address(this), _fxdxAllocation);
        fxdxTokensAllocated = IERC20Upgradeable(fxdx)
            .balanceOf(address(this))
            .toUint128();
        emit AllocateFXDX(_fxdxAllocation);
    }

    function _transferOutUsdbc(address to, uint256 amount) internal {
        IERC20Upgradeable(usdbc).safeTransfer(to, amount);
    }

    function _transferOutFXDX() internal {
        uint fxdxBalance = IERC20Upgradeable(weth).balanceOf(address(this));
        IERC20Upgradeable(fxdx).safeTransfer(msg.sender, fxdxBalance);
    }

    function updateUniswapPool(
        uint24 _poolFee,
        address _v3Swaprouter
    ) external onlyOwner {
        poolFee = _poolFee;
        v3SwapRouter = _v3Swaprouter;
    }

    function setethDeposit(bool _ethDeposit) external onlyOwner {
        ethDeposit = _ethDeposit;
    }

    // /// @custom:oz-upgrades-unsafe-allow constructor
    // constructor() {
    //     _disableInitializers();
    // }
}
