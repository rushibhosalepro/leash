// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Leash} from "../Leash.sol";
import {LeashTestBase} from "./Leash.Base.t.sol";

/// @notice Property: check() and pay() must always agree on outcome.
///
/// For every corpus scenario we call check() BEFORE pay() and assert they match.
/// We also test day-boundary behaviour (vm.warp past midnight) and rate-limit edge cases.
/// No vm.etch anywhere — 0x66 has no code.
contract LeashCheckTest is LeashTestBase {
    // Mirror the contract's public constants locally so we can use them in assertions.
    // Values are verified in setUp() against the live instance.
    uint8 internal constant PAID    = 0;
    uint8 internal constant HELD    = 1;
    uint8 internal constant BLOCKED = 2;

    function setUp() public override {
        super.setUp();
        // Sanity-check that constants haven't drifted from the contract.
        assertEq(leash.OUTCOME_PAID(),    PAID);
        assertEq(leash.OUTCOME_HELD(),    HELD);
        assertEq(leash.OUTCOME_BLOCKED(), BLOCKED);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Core helper: check() then pay(), assert agreement
    // ─────────────────────────────────────────────────────────────────────────

    /// Assert check() returns (wantOutcome, wantRule), then call pay() and verify
    /// the matching counter advanced (paidAlone / heldCount / blockedCount).
    /// Using counters avoids fragile vm.expectEmit id-matching.
    function _assertCheckThenPay(
        address payee,
        uint256 amount,
        string memory reason,
        uint8  wantOutcome,
        string memory wantRule
    ) internal {
        (uint8 outcome, string memory rule) = leash.check(payee, amount);
        assertEq(outcome, wantOutcome, string.concat("check outcome mismatch: ", reason));
        assertEq(rule,    wantRule,    string.concat("check rule mismatch: ",    reason));

        uint256 paidBefore    = leash.paidAlone();
        uint256 heldBefore    = leash.heldCount();
        uint256 blockedBefore = leash.blockedCount();

        vm.prank(agent);
        leash.pay(payee, amount, reason);

        if (wantOutcome == PAID) {
            assertEq(leash.paidAlone(),    paidBefore    + 1, string.concat("paidAlone should increment: ", reason));
            assertEq(leash.heldCount(),    heldBefore,        string.concat("heldCount should not change: ", reason));
            assertEq(leash.blockedCount(), blockedBefore,     string.concat("blockedCount should not change: ", reason));
        } else if (wantOutcome == HELD) {
            assertEq(leash.paidAlone(),    paidBefore,        string.concat("paidAlone should not change: ", reason));
            assertEq(leash.heldCount(),    heldBefore    + 1, string.concat("heldCount should increment: ", reason));
            assertEq(leash.blockedCount(), blockedBefore,     string.concat("blockedCount should not change: ", reason));
        } else {
            assertEq(leash.paidAlone(),    paidBefore,        string.concat("paidAlone should not change: ", reason));
            assertEq(leash.heldCount(),    heldBefore,        string.concat("heldCount should not change: ", reason));
            assertEq(leash.blockedCount(), blockedBefore + 1, string.concat("blockedCount should increment: ", reason));
        }
    }

    // Short alias for when we only care about the outcome.
    function _checkOutcome(address payee, uint256 amount) internal view returns (uint8) {
        (uint8 o,) = leash.check(payee, amount);
        return o;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 1 – In-policy payments
    // ─────────────────────────────────────────────────────────────────────────

    function test_Check_Group1_InPolicy_First5Paid() public {
        // First MAX_PER_HR (5) in-policy payments → all Paid
        for (uint256 i = 0; i < MAX_PER_HR; i++) {
            _assertCheckThenPay(alice, 1 ether, string.concat("g1-", vm.toString(i)), PAID, "");
        }
    }

    function test_Check_Group1_AfterRateLimit_Held() public {
        // Exhaust rate limit, then check predicts Held / rate_limit
        for (uint256 i = 0; i < MAX_PER_HR; i++) {
            _pay(alice, 1 ether);
        }
        _assertCheckThenPay(alice, 1 ether, "g1-rate-overflow", HELD, "rate_limit");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 2 – Per-payment cap
    // ─────────────────────────────────────────────────────────────────────────

    function test_Check_Group2_OverCap_Held() public {
        uint256 over = PER_CAP + 1 ether;
        for (uint256 i = 0; i < 5; i++) {
            _assertCheckThenPay(alice, over, string.concat("g2-", vm.toString(i)), HELD, "per_payment_cap");
        }
    }

    function test_Check_Group2_AtCap_Paid() public {
        _assertCheckThenPay(alice, PER_CAP, "g2-at-cap", PAID, "");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 3 – Daily cap (fill then overflow)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Check_Group3_DailyCap() public {
        // Fill daily cap: DAILY_CAP / PER_CAP = 5 payments
        uint256 fills = DAILY_CAP / PER_CAP;
        for (uint256 i = 0; i < fills; i++) {
            // Advance 15 min between payments to avoid rate limit
            vm.warp(block.timestamp + 15 minutes);
            _assertCheckThenPay(alice, PER_CAP, string.concat("g3-fill-", vm.toString(i)), PAID, "");
        }
        // Next payment exceeds daily cap
        vm.warp(block.timestamp + 15 minutes);
        _assertCheckThenPay(alice, PER_CAP, "g3-over-daily", HELD, "daily_cap");
        // Additional over-daily attempts
        for (uint256 i = 0; i < 4; i++) {
            _assertCheckThenPay(alice, PER_CAP, string.concat("g3-held-", vm.toString(i)), HELD, "daily_cap");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 4 – Unknown payee (allowlist enforced)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Check_Group4_UnknownPayee_Held() public {
        _allowlist(alice); // only alice is known
        for (uint256 i = 0; i < 5; i++) {
            _assertCheckThenPay(bob, 1 ether, string.concat("g4-", vm.toString(i)), HELD, "allowlist");
        }
    }

    function test_Check_Group4_KnownPayee_Paid() public {
        _allowlist(alice);
        _assertCheckThenPay(alice, 1 ether, "g4-known", PAID, "");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 5 – Rate limit burst
    // ─────────────────────────────────────────────────────────────────────────

    function test_Check_Group5_BurstRateLimit() public {
        // First MAX_PER_HR payments → Paid
        for (uint256 i = 0; i < MAX_PER_HR; i++) {
            _assertCheckThenPay(alice, 1 ether, string.concat("g5-ok-", vm.toString(i)), PAID, "");
        }
        // Remaining → Held
        for (uint256 i = 0; i < 5; i++) {
            _assertCheckThenPay(alice, 1 ether, string.concat("g5-held-", vm.toString(i)), HELD, "rate_limit");
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 6 – Frozen vault (hard block)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Check_Group6_Frozen_Blocked() public {
        vm.prank(owner);
        leash.freeze();

        for (uint256 i = 0; i < 5; i++) {
            _assertCheckThenPay(alice, 1 ether, string.concat("g6-", vm.toString(i)), BLOCKED, "frozen");
        }

        vm.prank(owner);
        leash.unfreeze();
        // After unfreeze, check returns Paid again.
        assertEq(_checkOutcome(alice, 1 ether), PAID);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GROUP 7 – Denylist (hard block)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Check_Group7_Denylist_Blocked() public {
        _denylist(carol);
        for (uint256 i = 0; i < 5; i++) {
            _assertCheckThenPay(carol, 1 ether, string.concat("g7-", vm.toString(i)), BLOCKED, "denylist");
        }
    }

    function test_Check_ZeroPayee_Blocked() public {
        _assertCheckThenPay(address(0), 1 ether, "zero-payee", BLOCKED, "zero_payee");
    }

    function test_Check_ZeroAmount_Blocked() public {
        _assertCheckThenPay(alice, 0, "zero-amount", BLOCKED, "zero_amount");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DAY-BOUNDARY: check() must agree with pay() across a warp
    // ─────────────────────────────────────────────────────────────────────────

    function test_Check_DayBoundary_ExhaustedThenRollover() public {
        // Exhaust daily cap (5 × PER_CAP, 15 min apart to avoid rate limit).
        uint256 fills = DAILY_CAP / PER_CAP;
        for (uint256 i = 0; i < fills; i++) {
            vm.warp(block.timestamp + 15 minutes);
            _pay(alice, PER_CAP);
        }
        assertEq(leash.dailySpent(), DAILY_CAP);

        // Still same day: check predicts Held.
        assertEq(_checkOutcome(alice, 1 ether), HELD);

        // Warp to next day.
        vm.warp(block.timestamp + 1 days);

        // check() must predict Paid (new day, effective spend = 0).
        (uint8 o, string memory r) = leash.check(alice, 1 ether);
        assertEq(o, PAID, "check after day roll should be Paid");
        assertEq(r, "",   "rule should be empty after day roll");

        // pay() must also succeed.
        vm.prank(agent);
        leash.pay(alice, 1 ether, "rollover");
        assertEq(leash.paidAlone(), fills + 1);
    }

    function test_Check_DayBoundary_RemainingToday_Resets() public {
        _pay(alice, PER_CAP);
        assertEq(leash.remainingToday(), DAILY_CAP - PER_CAP);

        // Warp to next day — remainingToday() should show full cap.
        vm.warp(block.timestamp + 1 days);
        assertEq(leash.remainingToday(), DAILY_CAP);
    }

    function test_Check_DayBoundary_CheckAndPayAgreeAfterWarp() public {
        // Exhaust daily cap, warp, confirm both check and pay agree it's Paid.
        uint256 fills = DAILY_CAP / PER_CAP;
        for (uint256 i = 0; i < fills; i++) {
            vm.warp(block.timestamp + 15 minutes);
            _pay(alice, PER_CAP);
        }
        vm.warp(block.timestamp + 1 days);
        _assertCheckThenPay(alice, PER_CAP, "day-boundary-agree", PAID, "");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // RATE-LIMIT edge cases with vm.warp
    // ─────────────────────────────────────────────────────────────────────────

    function test_Check_RateLimit_ExpiresAfterOneHour() public {
        // Exhaust rate limit.
        for (uint256 i = 0; i < MAX_PER_HR; i++) {
            _pay(alice, 1 ether);
        }
        assertEq(_checkOutcome(alice, 1 ether), HELD);

        // Warp just over 1 hour — all timestamps expire (cutoff = ts - 1h; payments were < cutoff).
        vm.warp(block.timestamp + 1 hours + 1);
        assertEq(_checkOutcome(alice, 1 ether), PAID);

        // check then pay agree after expiry.
        _assertCheckThenPay(alice, 1 ether, "rate-reset", PAID, "");
    }

    function test_Check_RateLimit_PartialExpiry() public {
        // 2 payments, warp just over 1 hour (they expire), then 3 more → all Paid (3 < MAX_PER_HR=5).
        for (uint256 i = 0; i < 2; i++) {
            _pay(alice, 1 ether);
        }
        vm.warp(block.timestamp + 1 hours + 1);
        for (uint256 i = 0; i < 3; i++) {
            _assertCheckThenPay(alice, 1 ether, string.concat("partial-", vm.toString(i)), PAID, "");
        }
        // Now at 3/5 in the window — still under limit.
        assertEq(_checkOutcome(alice, 1 ether), PAID);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INSUFFICIENT BALANCE reported by check()
    // ─────────────────────────────────────────────────────────────────────────

    function test_Check_InsufficientBalance_ReportedInRule() public {
        // Deploy a vault with exactly 50 ether so it can't cover PER_CAP = 100 ether.
        // All rules pass (agent, in-policy amount, allowlist empty, rate limit fresh).
        vm.deal(owner, 50 ether + 1 ether);
        vm.prank(owner);
        Leash small = new Leash{value: 50 ether}(owner, agent, PER_CAP, DAILY_CAP, MAX_PER_HR);

        (uint8 o, string memory r) = small.check(alice, PER_CAP);
        assertEq(o, PAID,                  "outcome should be PAID (rules pass)");
        assertEq(r, "insufficient_balance", "rule should flag insufficient_balance");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // remainingToday()
    // ─────────────────────────────────────────────────────────────────────────

    function test_RemainingToday_Fresh() public view {
        assertEq(leash.remainingToday(), DAILY_CAP);
    }

    function test_RemainingToday_AfterSpend() public {
        _pay(alice, 10 ether);
        assertEq(leash.remainingToday(), DAILY_CAP - 10 ether);
    }

    function test_RemainingToday_FlooredAtZero() public {
        // Exhaust the cap. setPolicy resets the rate buffer between rounds.
        uint256 remaining = DAILY_CAP;
        while (remaining >= PER_CAP) {
            // Reset rate limit so rate buffer never blocks us.
            vm.prank(owner);
            leash.setPolicy(agent, PER_CAP, DAILY_CAP, MAX_PER_HR);
            for (uint256 j = 0; j < MAX_PER_HR && leash.remainingToday() >= PER_CAP; j++) {
                vm.warp(block.timestamp + 1 minutes);
                _pay(alice, PER_CAP);
                remaining = leash.remainingToday();
            }
            if (leash.remainingToday() < PER_CAP) break;
        }
        assertEq(leash.remainingToday(), 0);
    }

    function test_RemainingToday_NextDayReset() public {
        _pay(alice, PER_CAP);
        vm.warp(block.timestamp + 1 days);
        assertEq(leash.remainingToday(), DAILY_CAP);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // No code at 0x66 — pay() and check() both work fine
    // ─────────────────────────────────────────────────────────────────────────

    function test_Pay_WorksWithNoCodeAt0x66() public {
        // Confirm no vm.etch: 0x66 has no code.
        assertEq(address(0x66).code.length, 0);
        // check() and pay() must work regardless.
        (uint8 o, string memory rl) = leash.check(alice, 1 ether);
        assertEq(o, PAID);
        assertEq(rl, "");
        _pay(alice, 1 ether);
        assertEq(leash.paidAlone(), 1);
    }
}
