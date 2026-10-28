// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Leash} from "../Leash.sol";
import {LeashTestBase} from "./Leash.Base.t.sol";

contract LeashPayTest is LeashTestBase {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. HAPPY PATH – in-policy payment
    // ─────────────────────────────────────────────────────────────────────────

    function test_InPolicy_TransfersNative() public {
        uint256 balBefore = alice.balance;
        _pay(alice, 10 ether);
        assertEq(alice.balance, balBefore + 10 ether);
    }

    function test_InPolicy_DecreasesVaultBalance() public {
        _pay(alice, 10 ether);
        assertEq(leash.balance(), INIT_BAL - 10 ether);
    }

    function test_InPolicy_EmitsPaid() public {
        vm.prank(agent);
        vm.expectEmit(true, true, false, true, address(leash));
        emit Leash.Paid(1, alice, 10 ether, "test");
        leash.pay(alice, 10 ether, "test");
    }

    function test_InPolicy_IncrementsPaidAlone() public {
        _pay(alice, 10 ether);
        assertEq(leash.paidAlone(), 1);
    }

    function test_InPolicy_IncrementsDailySpent() public {
        _pay(alice, 10 ether);
        assertEq(leash.dailySpent(), 10 ether);
    }

    function test_MultiplePayments_IdsIncrement() public {
        // First payment → id 1, second → id 2
        vm.prank(agent);
        vm.expectEmit(true, true, false, true, address(leash));
        emit Leash.Paid(1, alice, 1 ether, "p1");
        leash.pay(alice, 1 ether, "p1");

        vm.prank(agent);
        vm.expectEmit(true, true, false, true, address(leash));
        emit Leash.Paid(2, alice, 1 ether, "p2");
        leash.pay(alice, 1 ether, "p2");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. PER-PAYMENT CAP VIOLATION
    // ─────────────────────────────────────────────────────────────────────────

    function test_PerPaymentCap_EmitsHeld() public {
        uint256 over = PER_CAP + 1;
        vm.prank(agent);
        vm.expectEmit(true, true, false, true, address(leash));
        emit Leash.Held(1, alice, over, "big", "per_payment_cap");
        leash.pay(alice, over, "big");
    }

    function test_PerPaymentCap_NoFundsMove() public {
        uint256 over = PER_CAP + 1;
        uint256 balBefore = alice.balance;
        vm.prank(agent);
        leash.pay(alice, over, "big");
        assertEq(alice.balance, balBefore);
        assertEq(leash.balance(), INIT_BAL);
    }

    function test_PerPaymentCap_IncrementsHeldCount() public {
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "big");
        assertEq(leash.heldCount(), 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 3. DAILY CAP VIOLATION
    // ─────────────────────────────────────────────────────────────────────────

    function test_DailyCap_EmitsHeld() public {
        // Spend up to just below the daily cap
        uint256 chunk = PER_CAP; // 100 ether each
        // 5 payments × 100 = 500 = dailyCap; a 6th would breach
        for (uint256 i = 0; i < 5; i++) {
            _pay(alice, chunk);
        }
        // Next payment should be held for daily_cap
        vm.prank(agent);
        vm.expectEmit(true, true, false, true, address(leash));
        // id starts at 1; 5 Paid used ids 1-5, next is 6
        emit Leash.Held(6, alice, 1 ether, "over", "daily_cap");
        leash.pay(alice, 1 ether, "over");
    }

    function test_DailyCap_NoFundsMove() public {
        uint256 chunk = PER_CAP;
        for (uint256 i = 0; i < 5; i++) {
            _pay(alice, chunk);
        }
        uint256 balBefore = leash.balance();
        vm.prank(agent);
        leash.pay(alice, 1 ether, "over");
        assertEq(leash.balance(), balBefore);
    }

    function test_DailyCap_ResetsAfter24Hours() public {
        // Exhaust daily cap
        for (uint256 i = 0; i < 5; i++) {
            _pay(alice, PER_CAP);
        }
        // Advance 1 day + 1 second
        vm.warp(block.timestamp + 1 days + 1);
        // Should succeed now (new day)
        _pay(alice, 10 ether);
        assertEq(leash.dailySpent(), 10 ether);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 4. ALLOWLIST VIOLATION
    // ─────────────────────────────────────────────────────────────────────────

    function test_Allowlist_NonMemberHeld() public {
        _allowlist(alice); // non-empty allowlist; bob is not on it
        vm.prank(agent);
        vm.expectEmit(true, true, false, true, address(leash));
        emit Leash.Held(1, bob, 1 ether, "nope", "allowlist");
        leash.pay(bob, 1 ether, "nope");
    }

    function test_Allowlist_MemberPassesThrough() public {
        _allowlist(alice);
        uint256 balBefore = alice.balance;
        _pay(alice, 10 ether);
        assertEq(alice.balance, balBefore + 10 ether);
    }

    function test_Allowlist_EmptyMeansAnyone() public {
        // No allowlist set → bob can receive
        uint256 balBefore = bob.balance;
        _pay(bob, 5 ether);
        assertEq(bob.balance, balBefore + 5 ether);
    }

    function test_Allowlist_UpdatedEvent() public {
        address[] memory list = new address[](1);
        list[0] = alice;
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(leash));
        emit Leash.AllowlistUpdated(alice, true);
        leash.setAllowlist(list, true);

        assertTrue(leash.isAllowlisted(alice));
        assertEq(leash.allowlistSize(), 1);
    }

    function test_Allowlist_RemoveDecreasesSize() public {
        _allowlist(alice);
        assertEq(leash.allowlistSize(), 1);

        address[] memory list = new address[](1);
        list[0] = alice;
        vm.prank(owner);
        leash.setAllowlist(list, false);

        assertEq(leash.allowlistSize(), 0);
        assertFalse(leash.isAllowlisted(alice));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 5. RATE LIMIT VIOLATION
    // ─────────────────────────────────────────────────────────────────────────

    function test_RateLimit_NPlus1Held() public {
        // MAX_PER_HR = 5; send 5 within the same second
        for (uint256 i = 0; i < MAX_PER_HR; i++) {
            _pay(alice, 1 ether);
        }
        // The 6th should be held for rate_limit (id = MAX_PER_HR + 1 = 6)
        vm.prank(agent);
        vm.expectEmit(true, true, false, true, address(leash));
        emit Leash.Held(MAX_PER_HR + 1, alice, 1 ether, "fast", "rate_limit");
        leash.pay(alice, 1 ether, "fast");
    }

    function test_RateLimit_ResetsAfter1Hour() public {
        for (uint256 i = 0; i < MAX_PER_HR; i++) {
            _pay(alice, 1 ether);
        }
        // Advance just over 1 hour
        vm.warp(block.timestamp + 1 hours + 1);
        // Should pass through now
        _pay(alice, 1 ether);
        assertEq(leash.paidAlone(), MAX_PER_HR + 1);
    }

    function test_RateLimit_NoFundsMove() public {
        for (uint256 i = 0; i < MAX_PER_HR; i++) {
            _pay(alice, 1 ether);
        }
        uint256 balBefore = leash.balance();
        vm.prank(agent);
        leash.pay(alice, 1 ether, "fast");
        assertEq(leash.balance(), balBefore);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 6. INSUFFICIENT BALANCE
    // ─────────────────────────────────────────────────────────────────────────

    function test_Pay_InsufficientBalance_Reverts() public {
        // Deploy a fresh leash with almost no balance
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        Leash tiny = new Leash{value: 1 ether}(owner, agent, 10 ether, 100 ether, 5);

        vm.prank(agent);
        vm.expectRevert(
            abi.encodeWithSelector(Leash.InsufficientBalance.selector, 1 ether, 5 ether)
        );
        tiny.pay(alice, 5 ether, "broke");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7. FUZZ – any in-policy amount passes through
    // ─────────────────────────────────────────────────────────────────────────

    function testFuzz_InPolicy_TransfersExactAmount(uint256 amount) public {
        amount = bound(amount, 1, PER_CAP);
        uint256 balBefore = alice.balance;
        _pay(alice, amount);
        assertEq(alice.balance, balBefore + amount);
        assertEq(leash.balance(), INIT_BAL - amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 8. AUTONOMY RATE (3-return signature)
    // ─────────────────────────────────────────────────────────────────────────

    function test_AutonomyRate_PaidAndHeld() public {
        _pay(alice, 1 ether);                 // paidAlone = 1
        vm.prank(agent);
        leash.pay(alice, PER_CAP + 1, "h");  // held = 1
        (uint256 pa, uint256 held, uint256 blocked) = leash.autonomyRate();
        assertEq(pa, 1);
        assertEq(held, 1);
        assertEq(blocked, 0);
    }

    function test_AutonomyRate_IncludesBlocked() public {
        // Hard violation: denylist
        address[] memory list = new address[](1);
        list[0] = bob;
        vm.prank(owner);
        leash.setDenylist(list, true);

        vm.prank(agent);
        leash.pay(bob, 1 ether, "x");  // blocked = 1

        _pay(alice, 1 ether);          // paidAlone = 1

        (uint256 pa, uint256 held, uint256 blocked) = leash.autonomyRate();
        assertEq(pa, 1);
        assertEq(held, 0);
        assertEq(blocked, 1);
    }
}
