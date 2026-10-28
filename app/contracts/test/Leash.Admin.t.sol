// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Leash} from "../Leash.sol";
import {LeashTestBase} from "./Leash.Base.t.sol";

contract LeashAdminTest is LeashTestBase {
    // ─────────────────────────────────────────────────────────────────────────
    // FREEZE / UNFREEZE
    // ─────────────────────────────────────────────────────────────────────────

    function test_Freeze_SetsFrozenTrue() public {
        vm.prank(owner);
        leash.freeze();
        assertTrue(leash.frozen());
    }

    function test_Freeze_EmitsFrozen() public {
        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(leash));
        emit Leash.Frozen(true);
        leash.freeze();
    }

    function test_Freeze_PayEmitsBlocked() public {
        vm.prank(owner);
        leash.freeze();

        vm.prank(agent);
        vm.expectEmit(true, true, false, true, address(leash));
        emit Leash.Blocked(1, alice, 1 ether, "frozen", "frozen");
        leash.pay(alice, 1 ether, "frozen");
    }

    function test_Unfreeze_RestoresPay() public {
        vm.prank(owner);
        leash.freeze();

        vm.prank(owner);
        vm.expectEmit(false, false, false, true, address(leash));
        emit Leash.Frozen(false);
        leash.unfreeze();

        assertFalse(leash.frozen());
        // Payment should now succeed
        _pay(alice, 1 ether);
        assertEq(leash.paidAlone(), 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // APPROVE (id, false, 0)  — pays without allowlisting
    // ─────────────────────────────────────────────────────────────────────────

    function test_Approve_PaysHeldRequest() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");   // creates held id=1
        uint256 id = _firstHeldId();
        uint256 balBefore = alice.balance;

        vm.prank(owner);
        leash.approve(id, false, 0);

        assertEq(alice.balance, balBefore + PER_CAP + 1);
    }

    function test_Approve_EmitsApproved() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        vm.prank(owner);
        vm.expectEmit(true, true, false, true, address(leash));
        emit Leash.Approved(id, alice, PER_CAP + 1);
        leash.approve(id, false, 0);
    }

    function test_Approve_IncrementsApprovedCount() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        vm.prank(owner);
        leash.approve(id, false, 0);

        assertEq(leash.approvedCount(), 1);
    }

    function test_Approve_DecreaseVaultBalance() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();
        uint256 vaultBefore = leash.balance();

        vm.prank(owner);
        leash.approve(id, false, 0);

        assertEq(leash.balance(), vaultBefore - (PER_CAP + 1));
    }

    function test_Approve_MarksSettled() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        vm.prank(owner);
        leash.approve(id, false, 0);

        (,,,, bool exists, bool settled) = _getHeld(id);
        assertTrue(exists);
        assertTrue(settled);
    }

    function test_Approve_AlreadySettled_Reverts() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        vm.prank(owner);
        leash.approve(id, false, 0);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Leash.AlreadySettled.selector, id));
        leash.approve(id, false, 0);
    }

    function test_Approve_NotFound_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Leash.RequestNotFound.selector, 999));
        leash.approve(999, false, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // APPROVE (id, true, 0) — pays AND allowlists payee
    // ─────────────────────────────────────────────────────────────────────────

    function test_ApproveRemember_AllowlistsPayee() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        assertFalse(leash.isAllowlisted(alice));

        vm.prank(owner);
        leash.approve(id, true, 0);

        assertTrue(leash.isAllowlisted(alice));
        assertEq(leash.allowlistSize(), 1);
    }

    function test_ApproveRemember_EmitsAllowlistUpdated() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(leash));
        emit Leash.AllowlistUpdated(alice, true);
        leash.approve(id, true, 0);
    }

    function test_ApproveRemember_NextPayGoesThrough() public {
        // First: create held request (per-payment cap breach)
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        // Approve with remember=true; also raises cap so alice can go through
        vm.prank(owner);
        leash.approve(id, true, PER_CAP + 10 ether);

        // Now alice is allowlisted and cap is raised; same amount should pay alone
        uint256 balBefore = alice.balance;
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "retry");
        assertEq(alice.balance, balBefore + PER_CAP + 1);
        assertEq(leash.paidAlone(), 1); // the approved one doesn't count
    }

    // ─────────────────────────────────────────────────────────────────────────
    // APPROVE (id, false, newCap) — raises per-payment cap
    // ─────────────────────────────────────────────────────────────────────────

    function test_ApproveCap_EmitsCapRaised() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();
        uint256 newCap = PER_CAP * 2;

        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(leash));
        emit Leash.CapRaised(id, newCap);
        leash.approve(id, false, newCap);
    }

    function test_ApproveCap_RaisesPerPaymentCap() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();
        uint256 newCap = PER_CAP * 2;

        vm.prank(owner);
        leash.approve(id, false, newCap);

        (, uint256 ppc,,) = leash.policy();
        assertEq(ppc, newCap);
    }

    function test_ApproveCap_NoRaiseIfLowerThanCurrent() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        // newCap lower than current PER_CAP — should not update
        vm.prank(owner);
        leash.approve(id, false, PER_CAP / 2);

        (, uint256 ppc,,) = leash.policy();
        assertEq(ppc, PER_CAP); // unchanged
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DENY
    // ─────────────────────────────────────────────────────────────────────────

    function test_Deny_MarksSettled() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        vm.prank(owner);
        leash.deny(id);

        (,,,, bool exists, bool settled) = _getHeld(id);
        assertTrue(exists);
        assertTrue(settled);
    }

    function test_Deny_EmitsDenied() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        vm.prank(owner);
        vm.expectEmit(true, false, false, false, address(leash));
        emit Leash.Denied(id);
        leash.deny(id);
    }

    function test_Deny_IncrementsDeniedCount() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        vm.prank(owner);
        leash.deny(id);

        assertEq(leash.deniedCount(), 1);
    }

    function test_Deny_NoFundsMove() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();
        uint256 vaultBefore = leash.balance();

        vm.prank(owner);
        leash.deny(id);

        assertEq(leash.balance(), vaultBefore);
    }

    function test_Deny_AlreadySettled_Reverts() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "held");
        uint256 id = _firstHeldId();

        vm.prank(owner);
        leash.deny(id);

        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Leash.AlreadySettled.selector, id));
        leash.deny(id);
    }

    function test_Deny_NotFound_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Leash.RequestNotFound.selector, 42));
        leash.deny(42);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // WITHDRAW
    // ─────────────────────────────────────────────────────────────────────────

    function test_Withdraw_TransfersFunds() public {
        uint256 ownerBefore = owner.balance;
        vm.prank(owner);
        leash.withdraw(10 ether);
        assertEq(owner.balance, ownerBefore + 10 ether);
        assertEq(leash.balance(), INIT_BAL - 10 ether);
    }

    function test_Withdraw_EmitsWithdrawn() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(leash));
        emit Leash.Withdrawn(owner, 10 ether);
        leash.withdraw(10 ether);
    }

    function test_WithdrawAll_EmptiesBalance() public {
        vm.prank(owner);
        leash.withdrawAll();
        assertEq(leash.balance(), 0);
    }

    function test_Withdraw_InsufficientBalance_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(Leash.InsufficientBalance.selector, INIT_BAL, INIT_BAL + 1)
        );
        leash.withdraw(INIT_BAL + 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PENDING REQUESTS VIEW
    // ─────────────────────────────────────────────────────────────────────────

    function test_PendingRequests_ReturnsUnsettled() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "h1");
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "h2");

        Leash.HeldRequest[] memory pending = leash.pendingRequests();
        assertEq(pending.length, 2);
    }

    function test_PendingRequests_ExcludesSettled() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "h1");
        uint256 id = _firstHeldId();
        vm.prank(owner);
        leash.deny(id);

        Leash.HeldRequest[] memory pending = leash.pendingRequests();
        assertEq(pending.length, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DENYLIST
    // ─────────────────────────────────────────────────────────────────────────

    function test_Denylist_UpdatedEvent() public {
        address[] memory list = new address[](1);
        list[0] = carol;
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(leash));
        emit Leash.DenylistUpdated(carol, true);
        leash.setDenylist(list, true);

        assertTrue(leash.isDenylisted(carol));
    }

    function test_Denylist_RemoveWorks() public {
        _denylist(carol);
        address[] memory list = new address[](1);
        list[0] = carol;
        vm.prank(owner);
        leash.setDenylist(list, false);
        assertFalse(leash.isDenylisted(carol));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPERS
    // ─────────────────────────────────────────────────────────────────────────

    function _getHeld(uint256 id)
        internal view
        returns (address payee, uint256 amount, string memory reason, string memory ruleBroken, bool exists, bool settled)
    {
        // heldRequests public mapping getter returns the struct fields as a flat tuple:
        // (uint256 id, address payee, uint256 amount, string reason,
        //  string ruleBroken, bool exists, bool settled)
        (,address p, uint256 amt, string memory rsn, string memory rb, bool ex, bool sttl)
            = leash.heldRequests(id);
        return (p, amt, rsn, rb, ex, sttl);
    }
}
