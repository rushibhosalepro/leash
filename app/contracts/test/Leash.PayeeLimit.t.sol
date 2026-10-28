// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {Leash} from "../Leash.sol";
import {LeashTestBase} from "./Leash.Base.t.sol";

/// @notice Tests for per-payee spending limits (setPayeeLimit / clearPayeeLimit / payeeLimit).
///
/// Property tested: check() and pay() always agree, including across day boundaries
/// and with rate limits active.  No vm.etch anywhere — 0x66 has no code.
contract LeashPayeeLimitTest is LeashTestBase {

    uint8 internal constant PAID    = 0;
    uint8 internal constant HELD    = 1;

    // Payee-specific cap tighter than the vault-wide PER_CAP (100 ether).
    uint256 internal constant PAYEE_CAP      = 10 ether;
    // Payee daily cap allows exactly 3 × PAYEE_CAP before blocking.
    uint256 internal constant PAYEE_DAILY    = 30 ether;

    // ── helpers ──────────────────────────────────────────────────────────────

    function _setPayeeLimit(address payee, uint256 ppc, uint256 dc) internal {
        vm.prank(owner);
        leash.setPayeeLimit(payee, ppc, dc);
    }

    function _clearPayeeLimit(address payee) internal {
        vm.prank(owner);
        leash.clearPayeeLimit(payee);
    }

    /// Assert check() returns `wantOutcome` then call pay() and verify the outcome
    /// matches via counter changes.
    function _assertCheckThenPay(
        address payee,
        uint256 amount,
        string memory reason,
        uint8 wantOutcome
    ) internal {
        (uint8 got, ) = leash.check(payee, amount);
        assertEq(got, wantOutcome, "check() outcome mismatch");

        uint256 paidBefore    = leash.paidAlone();
        uint256 heldBefore    = leash.heldCount();
        uint256 blockedBefore = leash.blockedCount();

        vm.prank(agent);
        leash.pay(payee, amount, reason);

        if (wantOutcome == PAID) {
            assertEq(leash.paidAlone(),    paidBefore + 1,    "paidAlone should increment");
            assertEq(leash.heldCount(),    heldBefore,        "heldCount should not change");
            assertEq(leash.blockedCount(), blockedBefore,     "blockedCount should not change");
        } else { // HELD
            assertEq(leash.paidAlone(),    paidBefore,        "paidAlone should not change");
            assertEq(leash.heldCount(),    heldBefore + 1,    "heldCount should increment");
            assertEq(leash.blockedCount(), blockedBefore,     "blockedCount should not change");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. Per-payee per-payment cap

    function test_PayeePerPaymentCap_HoldsOverLimit() public {
        _setPayeeLimit(alice, PAYEE_CAP, 0);
        // PAYEE_CAP+1 is under vault-wide PER_CAP (100 ether) but over payee cap.
        _assertCheckThenPay(alice, PAYEE_CAP + 1 ether, "over payee cap", HELD);
    }

    function test_PayeePerPaymentCap_RuleString() public {
        _setPayeeLimit(alice, PAYEE_CAP, 0);
        (, string memory rule) = leash.check(alice, PAYEE_CAP + 1 ether);
        assertEq(rule, "payee_per_payment_cap");
    }

    function test_PayeePerPaymentCap_AtCapPasses() public {
        _setPayeeLimit(alice, PAYEE_CAP, 0);
        // Exactly at cap should pass.
        _assertCheckThenPay(alice, PAYEE_CAP, "at payee cap", PAID);
    }

    function test_PayeePerPaymentCap_ZeroMeansNoLimit() public {
        // perPaymentCap=0, dailyCap=0 → no extra limit; in-policy amounts pass.
        _setPayeeLimit(alice, 0, 0);
        _assertCheckThenPay(alice, PER_CAP, "no payee cap", PAID);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. Per-payee daily cap

    function test_PayeeDailyCap_HoldsAfterCumulative() public {
        _setPayeeLimit(alice, 0, PAYEE_DAILY);
        // Three payments of PAYEE_DAILY/3 = 10 ether each, filling the daily budget exactly.
        uint256 slice = PAYEE_DAILY / 3;
        _assertCheckThenPay(alice, slice, "payee-daily-1", PAID);
        _assertCheckThenPay(alice, slice, "payee-daily-2", PAID);
        _assertCheckThenPay(alice, slice, "payee-daily-3", PAID);
        // Fourth payment pushes over payee daily cap.
        _assertCheckThenPay(alice, 1 ether, "payee-daily-over", HELD);
    }

    function test_PayeeDailyCap_RuleString() public {
        _setPayeeLimit(alice, 0, PAYEE_DAILY);
        uint256 slice = PAYEE_DAILY / 3;
        for (uint256 i = 0; i < 3; i++) {
            vm.prank(agent);
            leash.pay(alice, slice, "fill");
        }
        (, string memory rule) = leash.check(alice, 1 ether);
        assertEq(rule, "payee_daily_cap");
    }

    function test_PayeeDailyCap_DayRolloverResets() public {
        _setPayeeLimit(alice, 0, PAYEE_DAILY);
        // Fill payee daily cap.
        vm.prank(agent);
        leash.pay(alice, PAYEE_DAILY, "fill");
        // check should now say Held.
        (uint8 o1, ) = leash.check(alice, 1 ether);
        assertEq(o1, HELD, "should be held after daily fill");

        // Warp past 24 hours.
        vm.warp(block.timestamp + 1 days + 1 seconds);

        // check should now say Paid — day rolled over.
        (uint8 o2, ) = leash.check(alice, 1 ether);
        assertEq(o2, PAID, "should be paid after day rollover");

        // check-then-pay agreement.
        _assertCheckThenPay(alice, 1 ether, "after-rollover", PAID);
    }

    function test_PayeeDailyCap_SpentResetsInPayeeLimit() public {
        _setPayeeLimit(alice, 0, PAYEE_DAILY);
        vm.prank(agent);
        leash.pay(alice, PAYEE_DAILY, "fill");

        vm.warp(block.timestamp + 1 days + 1 seconds);

        (, , uint256 spentToday, uint256 rem) = leash.payeeLimit(alice);
        assertEq(spentToday, 0, "spentToday should be 0 after rollover (view)");
        assertEq(rem, PAYEE_DAILY, "remaining should be full after rollover");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. Vault-wide and payee limits both enforced

    function test_BothLimits_VaultWideCapStillApplies() public {
        // payee cap is generous; vault-wide cap should still trigger.
        _setPayeeLimit(alice, PER_CAP * 2, 0);
        // Vault-wide PER_CAP applies first; PER_CAP+1 is still held.
        (uint8 o, string memory rule) = leash.check(alice, PER_CAP + 1 ether);
        assertEq(o, HELD);
        assertEq(rule, "per_payment_cap");
    }

    function test_BothLimits_PayeeCapTighterThanVault() public {
        _setPayeeLimit(alice, PAYEE_CAP, 0); // 10 ether < vault PER_CAP 100 ether
        // 50 ether: passes vault cap, fails payee cap.
        (uint8 o, string memory rule) = leash.check(alice, 50 ether);
        assertEq(o, HELD);
        assertEq(rule, "payee_per_payment_cap");
    }

    function test_BothLimits_VaultDailyCapStillApplies() public {
        _setPayeeLimit(alice, 0, DAILY_CAP * 2); // generous payee daily cap
        // Exhaust vault daily cap.
        // DAILY_CAP = 500 ether; PER_CAP = 100 ether; fill in 5 payments.
        for (uint256 i = 0; i < 5; i++) {
            vm.prank(agent);
            leash.pay(alice, PER_CAP, string.concat("fill", vm.toString(i)));
            // Re-warp slightly to avoid rate limit (maxPerHour=5 allows exactly 5).
        }
        // Vault daily cap exhausted; payee daily cap is fine.
        (uint8 o, string memory rule) = leash.check(alice, 1 ether);
        assertEq(o, HELD);
        assertEq(rule, "daily_cap"); // vault-wide, not payee
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. clearPayeeLimit removes the limit

    function test_ClearPayeeLimit_RemovesConstraint() public {
        _setPayeeLimit(alice, PAYEE_CAP, 0);
        // Confirm it blocks.
        (uint8 before, ) = leash.check(alice, PAYEE_CAP + 1 ether);
        assertEq(before, HELD);

        _clearPayeeLimit(alice);
        // Now it should pass (vault-wide PER_CAP is 100 ether).
        (uint8 after_, ) = leash.check(alice, PAYEE_CAP + 1 ether);
        assertEq(after_, PAID);
    }

    function test_ClearPayeeLimit_EmitsEvent() public {
        _setPayeeLimit(alice, PAYEE_CAP, PAYEE_DAILY);
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(leash));
        emit Leash.PayeeLimitSet(alice, 0, 0);
        leash.clearPayeeLimit(alice);
    }

    function test_ClearPayeeLimit_PayeeLimitViewReturnsZero() public {
        _setPayeeLimit(alice, PAYEE_CAP, PAYEE_DAILY);
        vm.prank(agent);
        leash.pay(alice, PAYEE_CAP, "before-clear");

        _clearPayeeLimit(alice);
        (uint256 ppc, uint256 dc, uint256 spent, uint256 rem) = leash.payeeLimit(alice);
        assertEq(ppc,   0);
        assertEq(dc,    0);
        assertEq(spent, 0);
        assertEq(rem,   type(uint256).max, "no daily cap => max remaining");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. Access control

    function test_SetPayeeLimit_OnlyOwner() public {
        vm.prank(agent);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.setPayeeLimit(alice, PAYEE_CAP, PAYEE_DAILY);
    }

    function test_ClearPayeeLimit_OnlyOwner() public {
        _setPayeeLimit(alice, PAYEE_CAP, PAYEE_DAILY);
        vm.prank(agent);
        vm.expectRevert(Leash.NotOwner.selector);
        leash.clearPayeeLimit(alice);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. payeeLimit() view

    function test_PayeeLimitView_Unset() public view {
        (uint256 ppc, uint256 dc, uint256 spent, uint256 rem) = leash.payeeLimit(alice);
        assertEq(ppc,   0);
        assertEq(dc,    0);
        assertEq(spent, 0);
        assertEq(rem,   type(uint256).max);
    }

    function test_PayeeLimitView_SetNoSpend() public {
        _setPayeeLimit(alice, PAYEE_CAP, PAYEE_DAILY);
        (uint256 ppc, uint256 dc, uint256 spent, uint256 rem) = leash.payeeLimit(alice);
        assertEq(ppc,   PAYEE_CAP);
        assertEq(dc,    PAYEE_DAILY);
        assertEq(spent, 0);
        assertEq(rem,   PAYEE_DAILY);
    }

    function test_PayeeLimitView_AfterPartialSpend() public {
        _setPayeeLimit(alice, 0, PAYEE_DAILY);
        vm.prank(agent);
        leash.pay(alice, 5 ether, "partial");
        (, , uint256 spent, uint256 rem) = leash.payeeLimit(alice);
        assertEq(spent, 5 ether);
        assertEq(rem,   PAYEE_DAILY - 5 ether);
    }

    function test_PayeeLimitView_RemainingMaxWhenNoDailyCap() public {
        _setPayeeLimit(alice, PAYEE_CAP, 0); // daily cap = 0 means no limit
        (, , , uint256 rem) = leash.payeeLimit(alice);
        assertEq(rem, type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. approve() does NOT consume payee daily budget

    function test_Approve_DoesNotConsumePayeeDailyBudget() public {
        // Set payee daily cap such that exactly one direct payment fits.
        _setPayeeLimit(alice, 0, PAYEE_DAILY);

        // Make a held payment (over vault daily cap — need to exhaust it then approve).
        // Easier: cause a hold via payee_daily_cap, then approve and check spend unchanged.
        // Pay PAYEE_DAILY via pay() to exhaust payee daily budget.
        vm.prank(agent);
        leash.pay(alice, PAYEE_DAILY, "exhaust");
        // Now alice's payee daily budget is full; next pay() will be Held.
        vm.prank(agent);
        leash.pay(alice, 1 ether, "held-payment");
        // Owner approves the held request.
        uint256 heldId = _firstHeldId();
        vm.prank(owner);
        leash.approve(heldId, false, 0);
        // Payee spent should still be PAYEE_DAILY (approve doesn't add).
        (, , uint256 spent, ) = leash.payeeLimit(alice);
        assertEq(spent, PAYEE_DAILY, "approve should not add to payee daily spend");
        // And alice should have received the funds.
        assertEq(leash.approvedCount(), 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. setPayeeLimit emits correct event

    function test_SetPayeeLimit_EmitsEvent() public {
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(leash));
        emit Leash.PayeeLimitSet(alice, PAYEE_CAP, PAYEE_DAILY);
        leash.setPayeeLimit(alice, PAYEE_CAP, PAYEE_DAILY);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 9. check() and pay() agree across day boundary with payee limit

    function test_CheckPayAgree_DayBoundary() public {
        _setPayeeLimit(alice, 0, PAYEE_DAILY);

        // Fill payee daily cap then warp past the day.
        vm.prank(agent);
        leash.pay(alice, PAYEE_DAILY, "fill");
        vm.warp(block.timestamp + 1 days + 1 seconds);

        // After rollover: check says Paid, pay() executes, counters agree.
        _assertCheckThenPay(alice, 1 ether, "post-rollover", PAID);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 10. Per-payee cap interacts correctly with rate limit

    function test_CheckPayAgree_RateLimit_ThenPayeeCapHeld() public {
        _setPayeeLimit(alice, PAYEE_CAP, 0);

        // Fill rate limit (MAX_PER_HR = 5 payments).
        for (uint256 i = 0; i < MAX_PER_HR; i++) {
            vm.prank(agent);
            leash.pay(alice, 1 ether, string.concat("rate-fill-", vm.toString(i)));
        }

        // Next payment: rate_limit hits first (checked before payee cap in _evaluate).
        (uint8 o, string memory rule) = leash.check(alice, 1 ether);
        assertEq(o, HELD);
        assertEq(rule, "rate_limit");

        // After warp: rate limit clears, payee cap now the binding constraint for large amount.
        vm.warp(block.timestamp + 1 hours + 1 seconds);
        (uint8 o2, string memory rule2) = leash.check(alice, PAYEE_CAP + 1 ether);
        assertEq(o2, HELD);
        assertEq(rule2, "payee_per_payment_cap");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 11. Unrelated payees are unaffected

    function test_PayeeLimit_DoesNotAffectOtherPayees() public {
        _setPayeeLimit(alice, PAYEE_CAP, PAYEE_DAILY);
        // bob has no payee limit; should be unaffected.
        _assertCheckThenPay(bob, PER_CAP, "bob-full-cap", PAID);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 12. Updating an existing limit (re-calling setPayeeLimit)

    function test_SetPayeeLimit_UpdateExisting() public {
        _setPayeeLimit(alice, PAYEE_CAP, 0);
        // Partial spend.
        vm.prank(agent);
        leash.pay(alice, PAYEE_CAP, "partial");

        // Tighten the per-payment cap to 1 ether.
        _setPayeeLimit(alice, 1 ether, 0);
        (uint8 o, string memory rule) = leash.check(alice, 2 ether);
        assertEq(o, HELD);
        assertEq(rule, "payee_per_payment_cap");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 13. No vm.etch — 0x66 has no code (regression guard)

    function test_NoEtchAt0x66() public view {
        assertEq(address(0x0000000000000000000000000000000000000066).code.length, 0);
    }
}
