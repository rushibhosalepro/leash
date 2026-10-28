// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {Leash} from "../Leash.sol";

/**
 * @title Corpus
 * @notice Replays 50 labelled payment attempts against a fresh Leash vault and
 *         prints "expected vs actual" for every scenario plus a final table of
 *         Paid / Held / Blocked totals and a WRONG count of cases whose actual
 *         outcome differs from the label.
 *
 * Run with:
 *   forge script contracts/script/Corpus.s.sol --rpc-url <rpc> -vv
 */
contract Corpus is Script {
    Leash public leash;

    address internal owner;
    address internal agent;

    // Known payees
    address internal apiVendor  = address(0xA001);
    address internal apiVendor2 = address(0xA002);
    address internal unknown1   = address(0xB001);
    address internal unknown2   = address(0xB002);
    address internal blocked1   = address(0xC001);

    // 18-decimal native amounts (same as wei on Arc)
    uint256 internal constant PER_CAP       = 1e6 * 1e12; // 1 USDC (6-dec) * 1e12 = native
    uint256 internal constant DAILY_CAP     = 5e6 * 1e12; // 5 USDC
    uint256 internal constant MAX_PER_HOUR  = 3;
    uint256 internal constant VAULT_BALANCE = 100e6 * 1e12; // 100 USDC

    // Outcome counters
    uint256 internal totalPaid;
    uint256 internal totalHeld;
    uint256 internal totalBlocked;
    uint256 internal wrongCount;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// @dev Record a case result. expected/actual are "Paid", "Held", or "Blocked".
    function _record(
        string memory lbl,
        string memory expected,
        string memory actual,
        bool pass
    ) internal {
        string memory status = pass ? "[PASS]" : "[FAIL]";
        console2.log(string.concat(status, " ", lbl));
        console2.log(string.concat("       expected: ", expected));
        console2.log(string.concat("       actual  : ", actual));
        if (!pass) wrongCount++;

        // Tally outcome
        bytes32 h = keccak256(bytes(actual));
        if (h == keccak256("Paid")) totalPaid++;
        else if (h == keccak256("Held")) totalHeld++;
        else if (h == keccak256("Blocked")) totalBlocked++;
    }

    function _paidOutcome(uint256 paBefore) internal view returns (string memory) {
        return leash.paidAlone() == paBefore + 1 ? "Paid" : "other";
    }

    function _heldOutcome(uint256 hcBefore) internal view returns (string memory) {
        return leash.heldCount() == hcBefore + 1 ? "Held" : "other";
    }

    function _blockedOutcome(uint256 bcBefore) internal view returns (string memory) {
        return leash.blockedCount() == bcBefore + 1 ? "Blocked" : "other";
    }

    // -----------------------------------------------------------------------
    // Script entry point
    // -----------------------------------------------------------------------

    function run() external {
        owner = msg.sender;
        agent = vm.envOr("LEASH_AGENT", address(0xDEAD));

        // Deploy vault with initial deposit
        vm.startBroadcast(owner);

        leash = new Leash{value: VAULT_BALANCE}(
            owner,
            agent,
            PER_CAP,
            DAILY_CAP,
            MAX_PER_HOUR
        );

        // Pre-configure: add known payees to allowlist, blocked1 to denylist
        address[] memory allowed = new address[](2);
        allowed[0] = apiVendor;
        allowed[1] = apiVendor2;
        leash.setAllowlist(allowed, true);

        address[] memory denied = new address[](1);
        denied[0] = blocked1;
        leash.setDenylist(denied, true);

        vm.stopBroadcast();

        console2.log("=== Leash Corpus: 50 payment scenarios ===");
        console2.log(string.concat("Vault: ", vm.toString(address(leash))));
        console2.log("");

        // ----------------------------------------------------------------
        // GROUP 1: In-policy payments (10 cases)
        // ----------------------------------------------------------------
        console2.log("--- GROUP 1: In-policy payments ---");

        for (uint256 i = 1; i <= 3; i++) {
            uint256 pa = leash.paidAlone();
            vm.prank(agent);
            leash.pay(apiVendor, 0.02e6 * 1e12, "pay API vendor $0.02");
            string memory actual = _paidOutcome(pa);
            _record(
                string.concat("1.", vm.toString(i), " pay API vendor $0.02"),
                "Paid",
                actual,
                keccak256(bytes(actual)) == keccak256("Paid")
            );
        }

        // Remaining 7 in-policy tests use a fresh rate window (warp +1h)
        vm.warp(block.timestamp + 3601);

        for (uint256 i = 4; i <= 10; i++) {
            uint256 pa = leash.paidAlone();
            vm.prank(agent);
            leash.pay(apiVendor, 0.01e6 * 1e12, string.concat("in-policy #", vm.toString(i)));
            string memory actual = _paidOutcome(pa);
            _record(
                string.concat("1.", vm.toString(i), " in-policy payment"),
                "Paid",
                actual,
                keccak256(bytes(actual)) == keccak256("Paid")
            );
            if (i < 10) vm.warp(block.timestamp + 1301); // spread within hour cap
        }

        // ----------------------------------------------------------------
        // GROUP 2: Per-payment cap violations (5 cases)
        // ----------------------------------------------------------------
        console2.log("");
        console2.log("--- GROUP 2: Over per-payment cap ---");
        vm.warp(block.timestamp + 3601);

        uint256 overCap = PER_CAP + 1;
        for (uint256 i = 1; i <= 5; i++) {
            uint256 hc = leash.heldCount();
            vm.prank(agent);
            leash.pay(apiVendor, overCap, string.concat("over-cap #", vm.toString(i)));
            string memory actual = _heldOutcome(hc);
            _record(
                string.concat("2.", vm.toString(i), " over per-payment cap"),
                "Held",
                actual,
                keccak256(bytes(actual)) == keccak256("Held")
            );
        }

        // ----------------------------------------------------------------
        // GROUP 3: Daily cap violations (10 cases)
        // ----------------------------------------------------------------
        console2.log("");
        console2.log("--- GROUP 3: Daily cap exhausted ---");
        vm.warp(block.timestamp + 1 days + 1); // fresh day

        // Exhaust daily cap (5 USDC total, 1 USDC each = 5 payments pass)
        for (uint256 i = 1; i <= 5; i++) {
            uint256 pa = leash.paidAlone();
            vm.prank(agent);
            leash.pay(apiVendor, PER_CAP, string.concat("daily fill #", vm.toString(i)));
            string memory actual = _paidOutcome(pa);
            _record(
                string.concat("3.", vm.toString(i), " filling daily cap"),
                "Paid",
                actual,
                keccak256(bytes(actual)) == keccak256("Paid")
            );
            vm.warp(block.timestamp + 1201); // spread to avoid rate limit
        }

        // These 5 should all be held for daily_cap
        for (uint256 i = 6; i <= 10; i++) {
            uint256 hc = leash.heldCount();
            vm.prank(agent);
            leash.pay(apiVendor, 0.01e6 * 1e12, string.concat("over daily #", vm.toString(i)));
            string memory actual = _heldOutcome(hc);
            _record(
                string.concat("3.", vm.toString(i), " over daily cap"),
                "Held",
                actual,
                keccak256(bytes(actual)) == keccak256("Held")
            );
        }

        // ----------------------------------------------------------------
        // GROUP 4: Unknown payee (allowlist active) (5 cases)
        // ----------------------------------------------------------------
        console2.log("");
        console2.log("--- GROUP 4: Unknown payee ---");
        vm.warp(block.timestamp + 1 days + 1);

        for (uint256 i = 1; i <= 5; i++) {
            uint256 hc = leash.heldCount();
            vm.prank(agent);
            leash.pay(unknown1, 0.01e6 * 1e12, string.concat("unknown payee #", vm.toString(i)));
            string memory actual = _heldOutcome(hc);
            _record(
                string.concat("4.", vm.toString(i), " unknown payee"),
                "Held",
                actual,
                keccak256(bytes(actual)) == keccak256("Held")
            );
        }

        // ----------------------------------------------------------------
        // GROUP 5: Burst over rate limit (10 cases)
        // ----------------------------------------------------------------
        console2.log("");
        console2.log("--- GROUP 5: Burst over rate limit ---");
        vm.warp(block.timestamp + 1 days + 1);

        // 3 should pass (maxPerHour = 3), rest held
        for (uint256 i = 1; i <= 10; i++) {
            if (i <= 3) {
                uint256 pa = leash.paidAlone();
                vm.prank(agent);
                leash.pay(apiVendor, 0.01e6 * 1e12, string.concat("burst #", vm.toString(i)));
                string memory actual = _paidOutcome(pa);
                _record(
                    string.concat("5.", vm.toString(i), " burst within limit"),
                    "Paid",
                    actual,
                    keccak256(bytes(actual)) == keccak256("Paid")
                );
            } else {
                uint256 hc = leash.heldCount();
                vm.prank(agent);
                leash.pay(apiVendor, 0.01e6 * 1e12, string.concat("burst #", vm.toString(i)));
                string memory actual = _heldOutcome(hc);
                _record(
                    string.concat("5.", vm.toString(i), " burst over rate limit"),
                    "Held",
                    actual,
                    keccak256(bytes(actual)) == keccak256("Held")
                );
            }
        }

        // ----------------------------------------------------------------
        // GROUP 6: Frozen vault (5 cases)
        // ----------------------------------------------------------------
        console2.log("");
        console2.log("--- GROUP 6: Frozen vault ---");
        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(owner);
        leash.freeze();

        for (uint256 i = 1; i <= 5; i++) {
            uint256 bc = leash.blockedCount();
            vm.prank(agent);
            leash.pay(apiVendor, 0.01e6 * 1e12, "pay while frozen");
            string memory actual = _blockedOutcome(bc);
            _record(
                string.concat("6.", vm.toString(i), " frozen vault blocks pay"),
                "Blocked",
                actual,
                keccak256(bytes(actual)) == keccak256("Blocked")
            );
        }

        // ----------------------------------------------------------------
        // GROUP 7: Denylist hard block (5 cases)
        // ----------------------------------------------------------------
        console2.log("");
        console2.log("--- GROUP 7: Denylist hard block ---");

        vm.prank(owner);
        leash.unfreeze();

        for (uint256 i = 1; i <= 5; i++) {
            uint256 bc = leash.blockedCount();
            vm.prank(agent);
            leash.pay(blocked1, 0.01e6 * 1e12, "pay denied payee");
            string memory actual = _blockedOutcome(bc);
            _record(
                string.concat("7.", vm.toString(i), " denylist hard block"),
                "Blocked",
                actual,
                keccak256(bytes(actual)) == keccak256("Blocked")
            );
        }

        // ----------------------------------------------------------------
        // Summary table
        // ----------------------------------------------------------------
        console2.log("");
        console2.log("=== CORPUS SUMMARY ===");
        console2.log(string.concat("  Paid    : ", vm.toString(totalPaid)));
        console2.log(string.concat("  Held    : ", vm.toString(totalHeld)));
        console2.log(string.concat("  Blocked : ", vm.toString(totalBlocked)));
        console2.log(string.concat("  Total   : ", vm.toString(totalPaid + totalHeld + totalBlocked)));
        console2.log(string.concat("  WRONG   : ", vm.toString(wrongCount)));
        console2.log("");
        console2.log(string.concat("  paidAlone   : ", vm.toString(leash.paidAlone())));
        console2.log(string.concat("  heldCount   : ", vm.toString(leash.heldCount())));
        console2.log(string.concat("  blockedCount: ", vm.toString(leash.blockedCount())));
        console2.log(string.concat("  approvedCount: ", vm.toString(leash.approvedCount())));
        console2.log(string.concat("  deniedCount : ", vm.toString(leash.deniedCount())));
        console2.log(string.concat("  frozen      : ", leash.frozen() ? "true" : "false"));

        (uint256 pa, uint256 held, uint256 blk) = leash.autonomyRate();
        uint256 grandTotal = pa + held + blk;
        if (grandTotal > 0) {
            console2.log(string.concat("  autonomy    : ", vm.toString(pa * 100 / grandTotal), "%"));
        } else {
            console2.log("  autonomy    : N/A");
        }
    }
}
