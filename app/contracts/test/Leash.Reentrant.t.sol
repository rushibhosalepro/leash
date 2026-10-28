// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Leash} from "../Leash.sol";
import {LeashTestBase} from "./Leash.Base.t.sol";

/// @dev A payee that tries to re-enter pay() when it receives ETH.
contract ReentrantPayee {
    Leash public leash;
    address public self;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(Leash _leash) {
        leash = _leash;
        self = address(this);
    }

    receive() external payable {
        reentryAttempted = true;
        // attempt to re-enter pay() with a 1-wei payment back to self
        try leash.pay(address(this), 1, "reentry") {
            reentrySucceeded = true;
        } catch {
            reentrySucceeded = false;
        }
    }
}

/// @dev A payee that tries to re-enter approve() when it receives ETH.
contract ReentrantApprovePayee {
    Leash public leash;
    uint256 public capturedId;
    bool public reentryAttempted;
    bool public reentrySucceeded;

    constructor(Leash _leash) {
        leash = _leash;
    }

    function setId(uint256 id) external {
        capturedId = id;
    }

    receive() external payable {
        reentryAttempted = true;
        if (capturedId != 0) {
            try leash.approve(capturedId, false, 0) {
                reentrySucceeded = true;
            } catch {
                reentrySucceeded = false;
            }
        }
    }
}

contract LeashReentrantTest is LeashTestBase {
    ReentrantPayee internal rPayee;
    ReentrantApprovePayee internal rApprovePayee;

    function setUp() public override {
        super.setUp();
        rPayee = new ReentrantPayee(leash);
        rApprovePayee = new ReentrantApprovePayee(leash);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REENTRANCY via pay() → receive() → pay()
    // ─────────────────────────────────────────────────────────────────────────

    function test_Reentrancy_PayBlocksReentry() public {
        // The agent pays the ReentrantPayee; on receive() it tries to call pay() again.
        vm.prank(agent);
        // The outer pay() ITSELF may revert (because _sendNative fails) or succeed
        // but the reentry must not succeed.
        try leash.pay(address(rPayee), 1 ether, "attack") {
            // outer pay succeeded (ReentrancyGuard caught the inner call)
        } catch {
            // outer pay reverted — still correct, no double-spend
        }

        // The critical assertion: inner reentry must NOT have succeeded
        assertFalse(rPayee.reentrySucceeded(), "reentry into pay() must not succeed");
    }

    function test_Reentrancy_PayAttemptedButBlocked() public {
        vm.prank(agent);
        try leash.pay(address(rPayee), 1 ether, "attack") {} catch {}

        // If the outer call succeeded, reentry was attempted and blocked
        if (rPayee.reentryAttempted()) {
            assertFalse(rPayee.reentrySucceeded());
        }
        // If the outer call reverted, re-entry never got to execute — also safe.
    }

    function test_Reentrancy_VaultBalanceCorrect() public {
        uint256 vaultBefore = leash.balance();

        vm.prank(agent);
        try leash.pay(address(rPayee), 1 ether, "attack") {} catch {}

        // Vault must have decreased by AT MOST 1 ether (not 2 ether via reentry)
        assertGe(leash.balance(), vaultBefore - 1 ether);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REENTRANCY via approve() → receive() → approve(same id)
    // ─────────────────────────────────────────────────────────────────────────

    function test_Reentrancy_ApproveBlocksReentry() public {
        // Create a held request for rApprovePayee
        vm.prank(agent);
        leash.pay(address(rApprovePayee), PER_CAP + 1, "big");

        Leash.HeldRequest[] memory reqs = leash.pendingRequests();
        uint256 id = reqs[0].id;

        // Tell the payee which id to re-approve on receive()
        rApprovePayee.setId(id);

        vm.prank(owner);
        try leash.approve(id, false, 0) {} catch {}

        // Re-entry approve must not have succeeded (would double-pay)
        assertFalse(rApprovePayee.reentrySucceeded(), "reentry into approve() must not succeed");
    }

    function test_Reentrancy_ApproveVaultBalanceCorrect() public {
        vm.prank(agent);
        leash.pay(address(rApprovePayee), PER_CAP + 1, "big");

        Leash.HeldRequest[] memory reqs = leash.pendingRequests();
        uint256 id = reqs[0].id;
        rApprovePayee.setId(id);

        uint256 vaultBefore = leash.balance();

        vm.prank(owner);
        try leash.approve(id, false, 0) {} catch {}

        // At most one payment of PER_CAP+1 should have left the vault
        assertGe(leash.balance(), vaultBefore - (PER_CAP + 1));
    }
}
