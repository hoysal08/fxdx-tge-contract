// SPDX-License-Identifier: BUSL-1.1
// This code is made available under the terms and conditions of the Business Source License 1.1 (BUSL-1.1).
// The act of publishing this code is driven by the aim to promote transparency and facilitate its utilization for educational purposes.
//   _   _ __  ____  __
//  | | | |  \/  \ \/ /
//  | |_| | |\/| |\  /
//  |  _  | |  | |/  \
//  |_| |_|_|  |_/_/\_\
//

pragma solidity 0.8.18;
import "hardhat/console.sol";
import "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import "@uniswap/lib/contracts/libraries/TransferHelper.sol";
import {OwnableUpgradeable} from "../../lib/openzeppelin-contracts-upgradeable/contracts/access/OwnableUpgradeable.sol";
import {IERC20Upgradeable} from "../../lib/openzeppelin-contracts-upgradeable/contracts/token/ERC20/IERC20Upgradeable.sol";
import {SafeERC20Upgradeable} from "../../lib/openzeppelin-contracts-upgradeable/contracts/token/ERC20/utils/SafeERC20Upgradeable.sol";
import {MathUpgradeable} from "../../lib/openzeppelin-contracts-upgradeable/contracts/utils/math/MathUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "../../lib/openzeppelin-contracts-upgradeable/contracts/security/ReentrancyGuardUpgradeable.sol";
import {SafeCastUpgradeable} from "../../lib/openzeppelin-contracts-upgradeable/contracts/utils/math/SafeCastUpgradeable.sol";
import {IWNative} from "../interfaces/IWNative.sol";

// import {INonfungiblePositionManager} from "../staking/interfaces/INonfungiblePositionManager.sol";
// import {IUniswapV3Pool} from "../staking/interfaces/IUniswapV3Pool.sol";

contract TGE is OwnableUpgradeable, ReentrancyGuardUpgradeable {
    using MathUpgradeable for uint256;
    using SafeCastUpgradeable for uint256;
    using SafeERC20Upgradeable for IERC20Upgradeable;

    event LogTokenDeposit(
        address indexed purchaser,
        address indexed beneficiary,
        uint256 value
    );
    event LogWithdrawEth(uint256 amount);
    event LogAllocateFXDX(uint256 amount);
    event LogClaimFXDX(
        address claimer,
        uint256 fxdxAmount,
        uint256 refundAmount
    );
    event LogSetUniswapV3Pool(address indexed pool, uint24 fee);

    error TGE_InvalidSaleStart();
    error TGE_InvalidSaleClose();
    error TGE_SaleNotStarted();
    error TGE_SaleHasStarted();
    error TGE_SaleEnded();
    error TGE_MaxDepositReached();
    error TGE_InvalidAddress();
    error TGE_TransferEthFailed();
    error TGE_AlreadyClaimed();
    error TGE_InvalidValue();
    error TGE_SaleHasNotEnded();
    error TGE_AlreadyWithdraw();
    error TGE_PoolHasNotSet();
    error TGE_LiquidityBelowSlippage();

    address public fxdx;
    uint128 public usdbcDeposited; // Keeps track of USDBC deposited
    uint128 public fxdxTokensAllocated; // FXDX Tokens allocated to this contract
    uint64 public saleStart; // Time when the token sale starts
    uint64 public saleClose; // Time when the token sale ends
    uint192 public usdbcHardCap; // Hard Cap for ETH to be collected from this TGE
    address public usdbc;
    address public weth;
    address public v3Router;
    mapping(address => uint256) public deposits; // Amount each user deposited
    mapping(address => bool) public isClaimed; // Keep track if user has already claimed FXDX
    bool public ethWithdrawn; // Flag that says if the owner of this contract has withdrawn the ETH raised by this TGE event

    uint constant price = 1200;
    uint constant pricePrecision = 10000;
    uint24 public poolFee;

    /// @param _saleStart time when the token sale starts
    /// @param _saleClose time when the token sale closes
    function initialize(
        address _fxdx,
        uint64 _saleStart,
        uint64 _saleClose,
        uint192 _usdbcHardCap,
        address _usdbc,
        address _weth,
        address _v3Router
    ) external initializer {
        OwnableUpgradeable.__Ownable_init();
        ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

        if (_saleStart <= block.timestamp) revert TGE_InvalidSaleStart();
        if (_saleClose <= _saleStart) revert TGE_InvalidSaleClose();

        fxdx = _fxdx;
        saleStart = _saleStart;
        saleClose = _saleClose;
        usdbcHardCap = _usdbcHardCap;
        usdbc = _usdbc;
        weth = _weth;
        v3Router = _v3Router;
        ethWithdrawn = false;
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
        if (msg.value == 0) revert TGE_InvalidValue();
        if (beneficiary == address(0) || beneficiary == address(this))
            revert TGE_InvalidAddress();
        if (block.timestamp < saleStart) revert TGE_SaleNotStarted();
        if (block.timestamp > saleClose) revert TGE_SaleEnded();
        // get usdbc from eth
        uint amountOut = swapETHtoUSDBC(msg.value, minOutUSD);
        _deposit(beneficiary, amountOut);
    }

    function depositUsdbc(address beneficiary, uint256 _amount) external {
        if (beneficiary == address(0) || beneficiary == address(this))
            revert TGE_InvalidAddress();
        if (block.timestamp < saleStart) revert TGE_SaleNotStarted();
        if (block.timestamp > saleClose) revert TGE_SaleEnded();
        if (_amount == 0) revert TGE_InvalidValue();

        _deposit(beneficiary, _amount);
    }

    function swapETHtoUSDBC(
        uint256 amountIn,
        uint256 minAmountOut
    ) internal returns (uint256 amountOut) {
        IWNative(weth).deposit{value: msg.value}();
        IWNative(weth).approve(address(v3Router), msg.value);

        ISwapRouter.ExactInputSingleParams memory params = ISwapRouter
            .ExactInputSingleParams({
                tokenIn: weth,
                tokenOut: usdbc,
                fee: poolFee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: minAmountOut,
                sqrtPriceLimitX96: 0
            });
        amountOut = ISwapRouter(v3Router).exactInputSingle(params);
    }

    function _deposit(address beneficiary, uint256 _amount) internal {
        IERC20Upgradeable(usdbc).transferFrom(beneficiary, _amount);

        deposits[beneficiary] = deposits[beneficiary] + msg.value;
        usdbcDeposited = usdbcDeposited + _amount.toUint128();
    }

    /// @dev Withdraws eth deposited into the contract. Only owner can call this.
    function withdraw(address to) external onlyOwner {
        if (block.timestamp <= saleClose) revert TGE_SaleHasNotEnded();
        if (ethWithdrawn) revert TGE_AlreadyWithdraw();
        uint256 ethToWithdraw = ethDeposited >= ethHardCap
            ? ethHardCap
            : ethDeposited;
        ethWithdrawn = true;
        _transferOutWrappedEth(to, ethToWithdraw);

        emit LogWithdrawEth(ethToWithdraw);
    }

    function claimFXDX()
        external
        // ClaimParams calldata _params
        nonReentrant
    {
        if (block.timestamp <= saleClose) revert TGE_SaleHasNotEnded();
        if (isClaimed[msg.sender]) revert TGE_AlreadyClaimed();
        uint256 _claimableAmount = claimableAmount(msg.sender);
        uint256 _refundAmount = refundAmount(msg.sender);
        isClaimed[msg.sender] = true;

        if (_claimableAmount > 0)
            IERC20Upgradeable(fxdx).safeTransfer(msg.sender, _claimableAmount);
        if (_refundAmount > 0) {
            _transferOutEth(msg.sender, _refundAmount);
        }
        emit LogClaimFXDX(msg.sender, _claimableAmount, _refundAmount);
    }

    function claimableAmount(
        address beneficiary
    ) public view returns (uint256) {
        return
            !isClaimed[beneficiary] && ethDeposited > 0
                ? (fxdxTokensAllocated * deposits[beneficiary]) / ethDeposited
                : 0;
    }

    function refundAmount(address beneficiary) public view returns (uint256) {
        if (isClaimed[beneficiary]) return 0;
        if (ethDeposited <= ethHardCap) return 0;
        return
            deposits[beneficiary] -
            (ethHardCap * deposits[beneficiary]) /
            ethDeposited;
    }

    function getCurrentFXDXPrice() external view returns (uint256) {
        if (block.timestamp <= saleStart) {
            return 0;
        }
        return
            ethDeposited >= ethHardCap
                ? (ethHardCap * 1e18) / fxdxTokensAllocated
                : (ethDeposited * 1e18) / fxdxTokensAllocated;
    }

    function allocateFXDX(uint256 _fxdxAllocation) external onlyOwner {
        if (block.timestamp > saleStart) revert TGE_SaleHasStarted();
        IERC20Upgradeable(fxdx).safeTransferFrom(
            msg.sender,
            address(this),
            _fxdxAllocation
        );
        fxdxTokensAllocated = IERC20Upgradeable(fxdx)
            .balanceOf(address(this))
            .toUint128();
        emit LogAllocateFXDX(_fxdxAllocation);
    }

    function _transferOutEth(address to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount, gas: 2300}("");
        if (!success) {
            _transferOutWrappedEth(to, amount);
        }
    }

    function _transferOutWrappedEth(address to, uint256 amount) internal {
        IWNative(weth).deposit{value: amount}();
        IERC20Upgradeable(weth).safeTransfer(to, amount);
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }
}
