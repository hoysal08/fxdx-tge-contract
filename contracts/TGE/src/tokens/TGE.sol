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

import { OwnableUpgradeable } from "../../lib/openzeppelin-contracts-upgradeable/contracts/access/OwnableUpgradeable.sol";
import { IERC20Upgradeable } from "../../lib/openzeppelin-contracts-upgradeable/contracts/token/ERC20/IERC20Upgradeable.sol";
import { SafeERC20Upgradeable } from "../../lib/openzeppelin-contracts-upgradeable/contracts/token/ERC20/utils/SafeERC20Upgradeable.sol";
import { MathUpgradeable } from "../../lib/openzeppelin-contracts-upgradeable/contracts/utils/math/MathUpgradeable.sol";
import { ReentrancyGuardUpgradeable } from "../../lib/openzeppelin-contracts-upgradeable/contracts/security/ReentrancyGuardUpgradeable.sol";
import { SafeCastUpgradeable } from "../../lib/openzeppelin-contracts-upgradeable/contracts/utils/math/SafeCastUpgradeable.sol";
import { IWNative } from "../interfaces/IWNative.sol";
import { INonfungiblePositionManager } from "../staking/interfaces/INonfungiblePositionManager.sol";
import { IUniswapV3Pool } from "../staking/interfaces/IUniswapV3Pool.sol";

contract TGE is OwnableUpgradeable, ReentrancyGuardUpgradeable {
  using MathUpgradeable for uint256;
  using SafeCastUpgradeable for uint256;
  using SafeERC20Upgradeable for IERC20Upgradeable;

  event LogTokenDeposit(address indexed purchaser, address indexed beneficiary, uint256 value);
  event LogWithdrawEth(uint256 amount);
  event LogAllocateFXDX(uint256 amount);
  event LogClaimFXDX(address claimer, uint256 fxdxAmount, uint256 refundAmount);
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

  address public uniswapFXDXEthPool; // can remove this
  address public fxdx;
  uint128 public ethDeposited; // Keeps track of ETH deposited
  uint24 public poolFee;
  uint128 public fxdxTokensAllocated; // FXDX Tokens allocated to this contract
  uint64 public saleStart; // Time when the token sale starts
  uint64 public saleClose; // Time when the token sale ends
  uint192 public ethHardCap; // Hard Cap for ETH to be collected from this TGE
  address public weth;
  mapping(address => uint256) public deposits; // Amount each user deposited
  mapping(address => bool) public isClaimed; // Keep track if user has already claimed FXDX
  bool public ethWithdrawn; // Flag that says if the owner of this contract has withdrawn the ETH raised by this TGE event
  address public nonfungiblePositionManager;
  address public uniswapV3Pool;

  struct ClaimParams {
    bool isPlaceBuyWall;
    uint128 minLiquidity;
  }

  /// @param _saleStart time when the token sale starts
  /// @param _saleClose time when the token sale closes
  function initialize(
    address _fxdx,
    uint64 _saleStart,
    uint64 _saleClose,
    uint192 _ethHardCap,
    address _weth,
    address _nonfungiblePositionManager 
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();
    ReentrancyGuardUpgradeable.__ReentrancyGuard_init();

    if (_saleStart <= block.timestamp) revert TGE_InvalidSaleStart();
    if (_saleClose <= _saleStart) revert TGE_InvalidSaleClose();

    fxdx = _fxdx;
    saleStart = _saleStart;
    saleClose = _saleClose;
    ethHardCap = _ethHardCap;
    weth = _weth;
    ethWithdrawn = false;
    nonfungiblePositionManager = _nonfungiblePositionManager;
  }

  /// Deposit fallback
  /// @dev must be equivalent to deposit(address beneficiary)
  receive() external payable nonReentrant {
    _deposit(msg.sender);
  }

  /// Deposit
  /// @param beneficiary will be able to claim tokens after saleClose
  /// @dev must be equivalent to receive()
  function deposit(address beneficiary) external payable nonReentrant {
    _deposit(beneficiary);
  }

  function _deposit(address beneficiary) internal {
    if (beneficiary == address(0) || beneficiary == address(this)) revert TGE_InvalidAddress();
    if (block.timestamp < saleStart) revert TGE_SaleNotStarted();
    if (block.timestamp > saleClose) revert TGE_SaleEnded();
    if (msg.value == 0) revert TGE_InvalidValue();

    deposits[beneficiary] = deposits[beneficiary] + msg.value;
    ethDeposited = ethDeposited + msg.value.toUint128();

    emit LogTokenDeposit(msg.sender, beneficiary, msg.value);
  }

  /// @dev Withdraws eth deposited into the contract. Only owner can call this.
  function withdraw(address to) external onlyOwner {
    if (block.timestamp <= saleClose) revert TGE_SaleHasNotEnded();
    if (ethWithdrawn) revert TGE_AlreadyWithdraw();
    uint256 ethToWithdraw = ethDeposited >= ethHardCap ? ethHardCap : ethDeposited;
    ethWithdrawn = true;
    _transferOutWrappedEth(to, ethToWithdraw);

    emit LogWithdrawEth(ethToWithdraw);
  }

  function claimFXDX(
    // ClaimParams calldata _params
    ) external nonReentrant {
    if (block.timestamp <= saleClose) revert TGE_SaleHasNotEnded();
    if (isClaimed[msg.sender]) revert TGE_AlreadyClaimed();
    if (uniswapV3Pool == address(0)) revert TGE_PoolHasNotSet();
    uint256 _claimableAmount = claimableAmount(msg.sender);
    uint256 _refundAmount = refundAmount(msg.sender);
    isClaimed[msg.sender] = true;

    if (_claimableAmount > 0) IERC20Upgradeable(fxdx).safeTransfer(msg.sender, _claimableAmount);
    if (_refundAmount > 0) {
      // if (_params.isPlaceBuyWall) {
      //   IWNative(weth).deposit{ value: _refundAmount }();
      //   _mintPositionInUniV3Pool(msg.sender, _refundAmount, _params.minLiquidity);
      // } else 

      _transferOutEth(msg.sender, _refundAmount);
    }
    emit LogClaimFXDX(msg.sender, _claimableAmount, _refundAmount);
  }

  function claimableAmount(address beneficiary) public view returns (uint256) {
    return
      !isClaimed[beneficiary] && ethDeposited > 0
        ? (fxdxTokensAllocated * deposits[beneficiary]) / ethDeposited
        : 0;
  }

  function refundAmount(address beneficiary) public view returns (uint256) {
    if (isClaimed[beneficiary]) return 0;
    if (ethDeposited <= ethHardCap) return 0;
    return deposits[beneficiary] - (ethHardCap * deposits[beneficiary]) / ethDeposited;
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

  function setUniswapV3Pool(address _pool, uint24 _fee) external onlyOwner {
    uniswapV3Pool = _pool;
    poolFee = _fee;
    emit LogSetUniswapV3Pool(_pool, _fee);
  }

  function allocateFXDX(uint256 _fxdxAllocation) external onlyOwner {
    if (block.timestamp > saleStart) revert TGE_SaleHasStarted();
    IERC20Upgradeable(fxdx).safeTransferFrom(msg.sender, address(this), _fxdxAllocation);
    fxdxTokensAllocated = IERC20Upgradeable(fxdx).balanceOf(address(this)).toUint128();
    emit LogAllocateFXDX(_fxdxAllocation);
  }

  function _transferOutEth(address to, uint256 amount) internal {
    (bool success, ) = to.call{ value: amount, gas: 2300 }("");
    if (!success) {
      _transferOutWrappedEth(to, amount);
    }
  }

  function _mintPositionInUniV3Pool(
    address _to,
    uint256 _refundAmount,
    uint128 _minLiquidity
  ) internal {
    // SLOAD
    INonfungiblePositionManager _nonfungiblePositionManager = INonfungiblePositionManager(
      nonfungiblePositionManager
    );

    IUniswapV3Pool _pool = IUniswapV3Pool(uniswapV3Pool);

    // calculate tick
    (, int24 tick, , , , , ) = _pool.slot0();
    int24 tickSpace = _pool.tickSpacing();
    // div first to make it dividable with tickSpace
    int24 tickBound = (tick / tickSpace) * tickSpace;

    // APPROVE to PosManager, only weth, since it's single-sided
    IERC20Upgradeable(weth).safeIncreaseAllowance(
      address(_nonfungiblePositionManager),
      _refundAmount
    );

    INonfungiblePositionManager.MintParams memory params;
    if (_pool.token1() == fxdx) {
      params = INonfungiblePositionManager.MintParams({
        token0: weth,
        token1: fxdx,
        fee: poolFee,
        tickLower: tickBound + tickSpace,
        tickUpper: tickBound + (2 * tickSpace),
        amount0Desired: _refundAmount,
        amount1Desired: 0,
        amount0Min: 0,
        amount1Min: 0,
        recipient: _to,
        deadline: block.timestamp
      });
    } else {
      params = INonfungiblePositionManager.MintParams({
        token0: fxdx,
        token1: weth,
        fee: poolFee,
        tickLower: tickBound - (2 * tickSpace),
        tickUpper: tickBound - tickSpace,
        amount0Desired: 0,
        amount1Desired: _refundAmount,
        amount0Min: 0,
        amount1Min: 0,
        recipient: _to,
        deadline: block.timestamp
      });
    }

    (, uint128 liquidity, , ) = _nonfungiblePositionManager.mint(params);
    if (liquidity < _minLiquidity) revert TGE_LiquidityBelowSlippage();
  }

  function _transferOutWrappedEth(address to, uint256 amount) internal {
    IWNative(weth).deposit{ value: amount }();
    IERC20Upgradeable(weth).safeTransfer(to, amount);
  }

  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }
}
