// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Leash} from "../Leash.sol";

/// @dev Abstract base – shared actors, constants, and setUp. No test functions here.
abstract contract LeashTestBase is Test {
    Leash internal leash;

    address internal owner  = makeAddr("owner");
    address internal agent  = makeAddr("agent");
    address internal alice  = makeAddr("alice");
    address internal bob    = makeAddr("bob");
    address internal carol  = makeAddr("carol");

    // Policy parameters
    uint256 internal constant PER_CAP    = 100 ether;  // 100 native-USDC
    uint256 internal constant DAILY_CAP  = 500 ether;
    uint256 internal constant MAX_PER_HR = 5;
    uint256 internal constant INIT_BAL   = 1_000 ether;

    // Foundry starts at block.timestamp = 1; _recentPaymentsCount subtracts 1 hour.
    // Warp to a realistic timestamp so that subtraction doesn't underflow.
    uint256 internal constant T0 = 7 days;

    function setUp() public virtual {
        // Warp past the underflow window (no guard on ts < 3600).
        vm.warp(T0);

        // No vm.etch — there is no Memo precompile inside the contract.
        // Tests must pass with no code at 0x0000000000000000000000000000000000000066.

        // Fund owner so it can send value in the constructor
        vm.deal(owner, INIT_BAL + 1 ether);

        vm.prank(owner);
        leash = new Leash{value: INIT_BAL}(owner, agent, PER_CAP, DAILY_CAP, MAX_PER_HR);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// Make a single in-policy payment from agent to `payee` for `amount`.
    function _pay(address payee, uint256 amount) internal {
        vm.prank(agent);
        leash.pay(payee, amount, "test");
    }

    /// Add a single address to the allowlist.
    function _allowlist(address payee) internal {
        address[] memory list = new address[](1);
        list[0] = payee;
        vm.prank(owner);
        leash.setAllowlist(list, true);
    }

    /// Add a single address to the denylist.
    function _denylist(address payee) internal {
        address[] memory list = new address[](1);
        list[0] = payee;
        vm.prank(owner);
        leash.setDenylist(list, true);
    }

    /// Return the first held-request id (the one most recently created).
    function _firstHeldId() internal view returns (uint256) {
        Leash.HeldRequest[] memory reqs = leash.pendingRequests();
        require(reqs.length > 0, "no pending requests");
        return reqs[0].id;
    }
}
