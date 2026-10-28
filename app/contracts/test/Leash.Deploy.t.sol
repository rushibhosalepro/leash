// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Leash} from "../Leash.sol";
import {LeashTestBase} from "./Leash.Base.t.sol";

contract LeashDeployTest is LeashTestBase {
    // ── constructor / initialization ─────────────────────────────────────────

    function test_OwnerIsConstructorArg() public view {
        assertEq(leash.owner(), owner);
    }

    function test_PolicyStoredCorrectly() public view {
        // policy() auto-getter returns (agent, perPaymentCap, dailyCap, maxPerHour)
        // because the struct contains dynamic arrays which Solidity drops from the tuple.
        (address a, uint256 ppc, uint256 dc, uint256 mph) = leash.policy();
        assertEq(a,   agent);
        assertEq(ppc, PER_CAP);
        assertEq(dc,  DAILY_CAP);
        assertEq(mph, MAX_PER_HR);
    }

    function test_InitialBalanceRecorded() public view {
        assertEq(leash.balance(), INIT_BAL);
    }

    function test_DepositedEventEmittedOnConstruct() public {
        vm.deal(owner, 10 ether);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit Leash.Deposited(owner, 10 ether);
        new Leash{value: 10 ether}(owner, agent, PER_CAP, DAILY_CAP, MAX_PER_HR);
    }

    function test_FrozenIsFalseInitially() public view {
        assertEq(leash.frozen(), false);
    }

    function test_CountersZeroInitially() public view {
        assertEq(leash.paidAlone(),    0);
        assertEq(leash.heldCount(),    0);
        assertEq(leash.approvedCount(),0);
        assertEq(leash.deniedCount(),  0);
        assertEq(leash.blockedCount(), 0);
    }

    function test_DayStartSetOnDeploy() public view {
        assertEq(leash.dayStart(), block.timestamp);
    }

    function test_ConstructorWithZeroValueNoDeposit() public {
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        Leash l = new Leash{value: 0}(owner, agent, PER_CAP, DAILY_CAP, MAX_PER_HR);
        assertEq(l.balance(), 0);
    }

    function test_ConstructorZeroOwnerReverts() public {
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        vm.expectRevert("Leash: zero owner");
        new Leash{value: 0}(address(0), agent, PER_CAP, DAILY_CAP, MAX_PER_HR);
    }

    function test_DepositViaReceive() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        (bool ok,) = address(leash).call{value: 5 ether}("");
        assertTrue(ok);
        assertEq(leash.balance(), INIT_BAL + 5 ether);
    }

    function test_DepositViaFunction() public {
        vm.deal(alice, 10 ether);
        vm.prank(alice);
        leash.deposit{value: 3 ether}();
        assertEq(leash.balance(), INIT_BAL + 3 ether);
    }

    function test_SetPolicyUpdatesAllFields() public {
        address newAgent = makeAddr("newAgent");
        vm.prank(owner);
        vm.expectEmit(true, false, false, true);
        emit Leash.PolicyUpdated(newAgent, 50 ether, 200 ether, 3);
        leash.setPolicy(newAgent, 50 ether, 200 ether, 3);

        (address a, uint256 ppc, uint256 dc, uint256 mph) = leash.policy();
        assertEq(a,   newAgent);
        assertEq(ppc, 50 ether);
        assertEq(dc,  200 ether);
        assertEq(mph, 3);
    }

    // ── transferOwnership ────────────────────────────────────────────────────

    function test_TransferOwnership_UpdatesOwner() public {
        vm.prank(owner);
        leash.transferOwnership(alice);
        assertEq(leash.owner(), alice);
    }

    function test_TransferOwnership_EmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, true, false, false, address(leash));
        emit Leash.OwnershipTransferred(owner, alice);
        leash.transferOwnership(alice);
    }

    function test_TransferOwnership_NewOwnerCanCallOwnerFunctions() public {
        vm.prank(owner);
        leash.transferOwnership(alice);

        // Alice (new owner) can freeze
        vm.prank(alice);
        leash.freeze();
        assertTrue(leash.frozen());
    }

    function test_TransferOwnership_OldOwnerLosesAccess() public {
        vm.prank(owner);
        leash.transferOwnership(alice);

        vm.prank(owner);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.freeze();
    }

    function test_TransferOwnership_ZeroAddressReverts() public {
        vm.prank(owner);
        vm.expectRevert("Leash: zero newOwner");
        leash.transferOwnership(address(0));
    }

    function test_TransferOwnership_NonOwnerReverts() public {
        vm.prank(alice);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.transferOwnership(bob);
    }

    // ── no-code-at-0x66: pay() must work without any contract at that address ─

    function test_Pay_WorksWithNoCodeAt0x66() public {
        // Confirm there is no code etched at the old memo precompile address.
        address memoAddr = address(0x0000000000000000000000000000000000000066);
        assertEq(memoAddr.code.length, 0, "0x66 must have no code");

        // A plain in-policy payment must succeed without any memo side-effect.
        uint256 balBefore = alice.balance;
        _pay(alice, 1 ether);
        assertEq(alice.balance, balBefore + 1 ether);
        assertEq(leash.paidAlone(), 1);
    }
}
