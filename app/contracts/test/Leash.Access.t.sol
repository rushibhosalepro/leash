// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Leash} from "../Leash.sol";
import {LeashTestBase} from "./Leash.Base.t.sol";

contract LeashAccessTest is LeashTestBase {
    // ─────────────────────────────────────────────────────────────────────────
    // NON-OWNER CANNOT CALL OWNER FUNCTIONS
    // ─────────────────────────────────────────────────────────────────────────

    function test_NonOwner_CannotSetPolicy() public {
        vm.prank(alice);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.setPolicy(agent, 1 ether, 5 ether, 1);
    }

    function test_NonOwner_CannotSetAllowlist() public {
        address[] memory list = new address[](1);
        list[0] = alice;
        vm.prank(alice);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.setAllowlist(list, true);
    }

    function test_NonOwner_CannotSetDenylist() public {
        address[] memory list = new address[](1);
        list[0] = alice;
        vm.prank(alice);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.setDenylist(list, true);
    }

    function test_NonOwner_CannotFreeze() public {
        vm.prank(alice);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.freeze();
    }

    function test_NonOwner_CannotUnfreeze() public {
        vm.prank(owner);
        leash.freeze();

        vm.prank(alice);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.unfreeze();
    }

    function test_NonOwner_CannotApprove() public {
        vm.prank(agent);
        leash.pay(bob, PER_CAP + 1, "held");

        Leash.HeldRequest[] memory reqs = leash.pendingRequests();
        uint256 id = reqs[0].id;

        vm.prank(alice);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.approve(id, false, 0);
    }

    function test_NonOwner_CannotDeny() public {
        vm.prank(agent);
        leash.pay(bob, PER_CAP + 1, "held");

        Leash.HeldRequest[] memory reqs = leash.pendingRequests();
        uint256 id = reqs[0].id;

        vm.prank(alice);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.deny(id);
    }

    function test_NonOwner_CannotWithdraw() public {
        vm.prank(alice);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.withdraw(1 ether);
    }

    function test_NonOwner_CannotWithdrawAll() public {
        vm.prank(alice);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.withdrawAll();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NON-AGENT CANNOT CALL pay()
    // ─────────────────────────────────────────────────────────────────────────

    function test_NonAgent_CannotPay() public {
        vm.prank(alice);
        vm.expectRevert(Leash.NotAgent.selector);
        leash.pay(bob, 1 ether, "nope");
    }

    function test_Owner_CannotPay() public {
        vm.prank(owner);
        vm.expectRevert(Leash.NotAgent.selector);
        leash.pay(bob, 1 ether, "nope");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HARD VIOLATIONS: no revert — move no funds, emit Blocked, increment count
    // ─────────────────────────────────────────────────────────────────────────

    // Denylist
    function test_Denylist_EmitsBlocked() public {
        _denylist(carol);

        vm.prank(agent);
        vm.expectEmit(true, true, false, true, address(leash));
        emit Leash.Blocked(1, carol, 1 ether, "denied", "denylist");
        leash.pay(carol, 1 ether, "denied");
    }

    function test_Denylist_IncrementsBlockedCount() public {
        _denylist(carol);

        vm.prank(agent);
        leash.pay(carol, 1 ether, "denied");
        assertEq(leash.blockedCount(), 1);
    }

    function test_Denylist_MultipleBlocks_CountAccumulates() public {
        _denylist(carol);

        for (uint256 i = 0; i < 3; i++) {
            vm.prank(agent);
            leash.pay(carol, 1 ether, "x");
        }
        assertEq(leash.blockedCount(), 3);
    }

    function test_Denylist_NoFundsMove() public {
        _denylist(carol);
        uint256 vaultBefore = leash.balance();
        uint256 carolBefore = carol.balance;

        vm.prank(agent);
        leash.pay(carol, 1 ether, "x");

        assertEq(leash.balance(), vaultBefore);
        assertEq(carol.balance, carolBefore);
    }

    function test_Denylist_DoesNotRevert() public {
        _denylist(carol);

        // Must NOT revert
        vm.prank(agent);
        leash.pay(carol, 1 ether, "denied");
    }

    // Frozen vault
    function test_Frozen_EmitsBlocked() public {
        vm.prank(owner);
        leash.freeze();

        vm.prank(agent);
        vm.expectEmit(true, true, false, true, address(leash));
        emit Leash.Blocked(1, alice, 1 ether, "frozen", "frozen");
        leash.pay(alice, 1 ether, "frozen");
    }

    function test_Frozen_IncrementsBlockedCount() public {
        vm.prank(owner);
        leash.freeze();

        vm.prank(agent);
        leash.pay(alice, 1 ether, "frozen");
        assertEq(leash.blockedCount(), 1);
    }

    function test_Frozen_NoFundsMove() public {
        vm.prank(owner);
        leash.freeze();
        uint256 vaultBefore = leash.balance();

        vm.prank(agent);
        leash.pay(alice, 1 ether, "frozen");

        assertEq(leash.balance(), vaultBefore);
    }

    function test_Frozen_DoesNotRevert() public {
        vm.prank(owner);
        leash.freeze();

        // Must NOT revert
        vm.prank(agent);
        leash.pay(alice, 1 ether, "frozen");
    }

    // Zero payee
    function test_ZeroPayee_EmitsBlocked() public {
        vm.prank(agent);
        vm.expectEmit(true, true, false, false, address(leash));
        emit Leash.Blocked(1, address(0), 1 ether, "zero", "zero_payee");
        leash.pay(address(0), 1 ether, "zero");
    }

    function test_ZeroPayee_IncrementsBlockedCount() public {
        vm.prank(agent);
        leash.pay(address(0), 1 ether, "zero");
        assertEq(leash.blockedCount(), 1);
    }

    function test_ZeroPayee_DoesNotRevert() public {
        // Must NOT revert
        vm.prank(agent);
        leash.pay(address(0), 1 ether, "zero");
    }

    // Zero amount
    function test_ZeroAmount_EmitsBlocked() public {
        vm.prank(agent);
        vm.expectEmit(true, true, false, false, address(leash));
        emit Leash.Blocked(1, alice, 0, "zero", "zero_amount");
        leash.pay(alice, 0, "zero");
    }

    function test_ZeroAmount_IncrementsBlockedCount() public {
        vm.prank(agent);
        leash.pay(alice, 0, "zero");
        assertEq(leash.blockedCount(), 1);
    }

    function test_ZeroAmount_DoesNotRevert() public {
        // Must NOT revert
        vm.prank(agent);
        leash.pay(alice, 0, "zero");
    }

    // Multiple mixed hard violations increment the counter correctly
    function test_MixedHardViolations_BlockedCountAccumulates() public {
        _denylist(carol);

        vm.prank(owner);
        leash.freeze();

        // frozen → blocked
        vm.prank(agent);
        leash.pay(alice, 1 ether, "a");

        vm.prank(owner);
        leash.unfreeze();

        // denylist → blocked
        vm.prank(agent);
        leash.pay(carol, 1 ether, "b");

        // zero amount → blocked
        vm.prank(agent);
        leash.pay(alice, 0, "c");

        assertEq(leash.blockedCount(), 3);
    }
}
