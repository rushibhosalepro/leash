// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Leash is ReentrancyGuard {
    struct Policy {
        address agent;
        uint256 perPaymentCap;
        uint256 dailyCap;
        uint256 maxPerHour;
        address[] allowlist;
        address[] denylist;
    }

    struct PayeeLimit {
        uint256 perPaymentCap; // 0 = no per-payee per-payment limit
        uint256 dailyCap;      // 0 = no per-payee daily limit
        uint256 spent;         // cumulative spend in the current payee day window
        uint256 dayStart;      // timestamp when the current payee day window started
        bool set;              // true once setPayeeLimit has been called for this payee
    }

    struct HeldRequest {
        uint256 id;
        address payee;
        uint256 amount;
        string reason;
        string ruleBroken;
        bool exists;
        bool settled;
    }

    event Deposited(address indexed owner, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event PolicyUpdated(address indexed agent, uint256 perPaymentCap, uint256 dailyCap, uint256 maxPerHour);
    event AllowlistUpdated(address indexed payee, bool allowed);
    event DenylistUpdated(address indexed payee, bool denied);
    event Paid(uint256 indexed id, address indexed payee, uint256 amount, string reason);
    event Held(uint256 indexed id, address indexed payee, uint256 amount, string reason, string ruleBroken);
    event Blocked(uint256 indexed id, address indexed payee, uint256 amount, string reason, string ruleBroken);
    event Approved(uint256 indexed id, address indexed payee, uint256 amount);
    event Denied(uint256 indexed id);
    event Frozen(bool frozen);
    event CapRaised(uint256 indexed id, uint256 newCap);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PayeeLimitSet(address indexed payee, uint256 perPaymentCap, uint256 dailyCap);

    error NotOwner();
    error NotAgent();
    error RequestNotFound(uint256 id);
    error AlreadySettled(uint256 id);
    error InsufficientBalance(uint256 available, uint256 required);

    address public owner;

    bool public frozen;
    uint256 public balance;
    Policy public policy;

    mapping(address => bool) private _allowlisted;
    mapping(address => bool) private _denylisted;
    mapping(address => PayeeLimit) private _payeeLimits;

    mapping(uint256 => HeldRequest) public heldRequests;
    uint256[] private _heldIds;

    uint256 public paidAlone;
    uint256 public heldCount;
    uint256 public approvedCount;
    uint256 public deniedCount;
    uint256 public blockedCount;

    uint256 public dailySpent;
    uint256 public dayStart;

    // Ring buffer for rate-limit tracking (bounded by maxPerHour to prevent DoS).
    // _rateHead points to the oldest slot; _rateCount is the number of valid entries.
    uint256[] private _rateBuf;
    uint256 private _rateHead;
    uint256 private _rateCount;

    uint256 public allowlistSize;

    uint256 private _nextId;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != policy.agent) revert NotAgent();
        _;
    }

    constructor(address owner_, address agent, uint256 perPaymentCap, uint256 dailyCap, uint256 maxPerHour) payable {
        require(owner_ != address(0), "Leash: zero owner");
        owner = owner_;
        dayStart = block.timestamp;
        _nextId = 1;

        policy.agent = agent;
        policy.perPaymentCap = perPaymentCap;
        policy.dailyCap = dailyCap;
        policy.maxPerHour = maxPerHour;

        // Pre-allocate ring buffer (size = maxPerHour + 1 to distinguish full vs empty).
        if (maxPerHour > 0) {
            _rateBuf = new uint256[](maxPerHour + 1);
        }

        if (msg.value > 0) {
            balance += msg.value;
            emit Deposited(owner_, msg.value);
        }
    }

    receive() external payable {
        _deposit();
    }

    function deposit() external payable {
        _deposit();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Leash: zero newOwner");
        address prev = owner;
        owner = newOwner;
        emit OwnershipTransferred(prev, newOwner);
    }

    function setPolicy(address agent, uint256 perPaymentCap, uint256 dailyCap, uint256 maxPerHour) external onlyOwner {
        policy.agent = agent;
        policy.perPaymentCap = perPaymentCap;
        policy.dailyCap = dailyCap;
        policy.maxPerHour = maxPerHour;

        // Re-allocate ring buffer for the new rate limit.
        if (maxPerHour > 0) {
            _rateBuf = new uint256[](maxPerHour + 1);
        } else {
            delete _rateBuf;
        }
        _rateHead = 0;
        _rateCount = 0;

        emit PolicyUpdated(agent, perPaymentCap, dailyCap, maxPerHour);
    }

    function setAllowlist(address[] calldata payees, bool allowed) external onlyOwner {
        uint256 length = payees.length;
        for (uint256 i = 0; i < length; i++) {
            address payee = payees[i];

            if (allowed) {
                if (!_allowlisted[payee]) {
                    _allowlisted[payee] = true;
                    allowlistSize += 1;
                    _addToPolicyAllowlist(payee);
                }
            } else {
                if (_allowlisted[payee]) {
                    _allowlisted[payee] = false;
                    allowlistSize -= 1;
                    _removeFromPolicyAllowlist(payee);
                }
            }

            emit AllowlistUpdated(payee, allowed);
        }
    }

    function setDenylist(address[] calldata payees, bool denied) external onlyOwner {
        uint256 length = payees.length;
        for (uint256 i = 0; i < length; i++) {
            address payee = payees[i];

            if (denied) {
                if (!_denylisted[payee]) {
                    _denylisted[payee] = true;
                    _addToPolicyDenylist(payee);
                }
            } else {
                if (_denylisted[payee]) {
                    _denylisted[payee] = false;
                    _removeFromPolicyDenylist(payee);
                }
            }

            emit DenylistUpdated(payee, denied);
        }
    }

    /// @notice Set a per-payee spending limit. 0 means "no limit" for that field.
    function setPayeeLimit(address payee, uint256 perPaymentCap, uint256 dailyCap) external onlyOwner {
        PayeeLimit storage pl = _payeeLimits[payee];
        pl.perPaymentCap = perPaymentCap;
        pl.dailyCap      = dailyCap;
        if (!pl.set) {
            pl.dayStart = block.timestamp;
            pl.set = true;
        }
        emit PayeeLimitSet(payee, perPaymentCap, dailyCap);
    }

    /// @notice Remove any per-payee limit for `payee`.
    function clearPayeeLimit(address payee) external onlyOwner {
        delete _payeeLimits[payee];
        emit PayeeLimitSet(payee, 0, 0);
    }

    /// @notice Read the per-payee limit and current spend.
    /// @return perPaymentCap_ The payee per-payment cap (0 = none).
    /// @return dailyCap_      The payee daily cap (0 = none).
    /// @return spentToday     Spend in the current day window (0 if a new day has started).
    /// @return remainingToday_ Remaining budget: dailyCap - spentToday (0 if over;
    ///                         type(uint256).max if dailyCap is 0, meaning no limit).
    function payeeLimit(address payee)
        external
        view
        returns (
            uint256 perPaymentCap_,
            uint256 dailyCap_,
            uint256 spentToday,
            uint256 remainingToday_
        )
    {
        PayeeLimit storage pl = _payeeLimits[payee];
        perPaymentCap_ = pl.perPaymentCap;
        dailyCap_      = pl.dailyCap;
        spentToday     = (pl.set && block.timestamp < pl.dayStart + 1 days) ? pl.spent : 0;
        if (pl.dailyCap == 0) {
            remainingToday_ = type(uint256).max;
        } else {
            remainingToday_ = pl.dailyCap > spentToday ? pl.dailyCap - spentToday : 0;
        }
    }

    // ── Outcome constants ──────────────────────────────────────────────────────
    uint8 public constant OUTCOME_PAID    = 0;
    uint8 public constant OUTCOME_HELD    = 1;
    uint8 public constant OUTCOME_BLOCKED = 2;

    /// @notice Preview whether a payment would be paid, held, or blocked, and why.
    ///         Calling this and then pay() always agree: both use _evaluate() internally.
    /// @param payee  The intended recipient.
    /// @param amount The amount in native-USDC units.
    /// @return outcome 0=Paid, 1=Held, 2=Blocked
    /// @return rule    The ruleBroken string (empty when outcome is Paid, "insufficient_balance"
    ///                 when the payment would pass all rules but the vault cannot cover it).
    function check(address payee, uint256 amount) external view returns (uint8 outcome, string memory rule) {
        return _evaluate(payee, amount);
    }

    /// @notice How much budget is left in today's spending window.
    ///         Returns dailyCap - dailySpent (floored at 0), rolling over if a new day has started.
    function remainingToday() external view returns (uint256) {
        uint256 spent = (block.timestamp >= dayStart + 1 days) ? 0 : dailySpent;
        return policy.dailyCap > spent ? policy.dailyCap - spent : 0;
    }

    /// @notice Called by the agent to request a payment.
    ///         Hard violations (frozen, zero payee, denylist, zero amount) do NOT revert:
    ///         they move no funds, increment blockedCount, and emit Blocked.
    ///         Soft violations (caps, allowlist, rate limit) create a held request.
    ///         InsufficientBalance reverts because it represents a bookkeeping failure,
    ///         not a policy decision.
    function pay(address payee, uint256 amount, string calldata reason) external nonReentrant onlyAgent {
        uint256 id = _nextId;

        (uint8 outcome, string memory rule) = _evaluate(payee, amount);

        if (outcome == OUTCOME_BLOCKED) {
            _nextId += 1;
            blockedCount += 1;
            emit Blocked(id, payee, amount, reason, rule);
            return;
        }

        if (outcome == OUTCOME_HELD) {
            _createHeld(payee, amount, reason, rule);
            return;
        }

        // OUTCOME_PAID — execute the payment.
        if (balance < amount) revert InsufficientBalance(balance, amount);

        _nextId += 1;

        balance -= amount;
        _rollDayIfNeeded();
        dailySpent += amount;
        _recordPaymentTimestamp(block.timestamp);

        // Update per-payee daily spend (approve() intentionally does not touch this).
        PayeeLimit storage ppl = _payeeLimits[payee];
        if (ppl.set && ppl.dailyCap != 0) {
            if (block.timestamp >= ppl.dayStart + 1 days) {
                ppl.spent    = amount;
                ppl.dayStart = block.timestamp;
            } else {
                ppl.spent += amount;
            }
        }

        _sendNative(payee, amount);

        paidAlone += 1;
        emit Paid(id, payee, amount, reason);
    }

    /// @dev Shared evaluation kernel used by both check() (pure view) and pay().
    ///      Evaluates in the same order pay() historically checked rules so behaviour is identical.
    ///      Daily-cap check uses an effective spend that treats the day as rolled if a new day has
    ///      started, without touching state.
    function _evaluate(address payee, uint256 amount)
        internal
        view
        returns (uint8 outcome, string memory rule)
    {
        // ── Hard violations → Blocked ─────────────────────────────────────────
        if (frozen)              return (OUTCOME_BLOCKED, "frozen");
        if (payee == address(0)) return (OUTCOME_BLOCKED, "zero_payee");
        if (_denylisted[payee])  return (OUTCOME_BLOCKED, "denylist");
        if (amount == 0)         return (OUTCOME_BLOCKED, "zero_amount");

        // ── Soft violations → Held ────────────────────────────────────────────
        if (amount > policy.perPaymentCap) return (OUTCOME_HELD, "per_payment_cap");

        // Day-roll: if a new day has started, effective dailySpent is 0 (without writing state).
        uint256 effectiveSpent = (block.timestamp >= dayStart + 1 days) ? 0 : dailySpent;
        if (effectiveSpent + amount > policy.dailyCap) return (OUTCOME_HELD, "daily_cap");

        if (allowlistSize > 0 && !_allowlisted[payee]) return (OUTCOME_HELD, "allowlist");

        if (_recentPaymentsCount() >= policy.maxPerHour) return (OUTCOME_HELD, "rate_limit");

        // ── Per-payee limits (additional constraints on top of vault-wide limits) ──
        PayeeLimit storage pl = _payeeLimits[payee];
        if (pl.set) {
            if (pl.perPaymentCap != 0 && amount > pl.perPaymentCap)
                return (OUTCOME_HELD, "payee_per_payment_cap");

            if (pl.dailyCap != 0) {
                uint256 payeeSpent = (block.timestamp < pl.dayStart + 1 days) ? pl.spent : 0;
                if (payeeSpent + amount > pl.dailyCap)
                    return (OUTCOME_HELD, "payee_daily_cap");
            }
        }

        // ── Would pass all rules, but vault might not have funds ──────────────
        if (balance < amount) return (OUTCOME_PAID, "insufficient_balance");

        return (OUTCOME_PAID, "");
    }

    function approve(uint256 id, bool rememberPayee, uint256 newCap) external onlyOwner nonReentrant {
        HeldRequest storage request = heldRequests[id];
        if (!request.exists) revert RequestNotFound(id);
        if (request.settled) revert AlreadySettled(id);

        if (newCap > 0 && newCap > policy.perPaymentCap) {
            policy.perPaymentCap = newCap;
            emit CapRaised(id, newCap);
        }

        if (rememberPayee && !_allowlisted[request.payee]) {
            _allowlisted[request.payee] = true;
            allowlistSize += 1;
            _addToPolicyAllowlist(request.payee);
            emit AllowlistUpdated(request.payee, true);
        }

        if (balance < request.amount) revert InsufficientBalance(balance, request.amount);

        request.settled = true;

        balance -= request.amount;
        _sendNative(request.payee, request.amount);

        approvedCount += 1;
        emit Approved(id, request.payee, request.amount);
    }

    function deny(uint256 id) external onlyOwner {
        HeldRequest storage request = heldRequests[id];
        if (!request.exists) revert RequestNotFound(id);
        if (request.settled) revert AlreadySettled(id);

        request.settled = true;
        deniedCount += 1;

        emit Denied(id);
    }

    function freeze() external onlyOwner {
        frozen = true;
        emit Frozen(true);
    }

    function unfreeze() external onlyOwner {
        frozen = false;
        emit Frozen(false);
    }

    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        _withdraw(amount);
    }

    function withdrawAll() external onlyOwner nonReentrant {
        _withdraw(balance);
    }

    function pendingRequests() external view returns (HeldRequest[] memory) {
        uint256 length = _heldIds.length;
        uint256 unsettledCount;

        for (uint256 i = 0; i < length; i++) {
            if (!heldRequests[_heldIds[i]].settled) {
                unsettledCount += 1;
            }
        }

        HeldRequest[] memory pending = new HeldRequest[](unsettledCount);
        uint256 index;

        for (uint256 i = 0; i < length; i++) {
            HeldRequest storage request = heldRequests[_heldIds[i]];
            if (!request.settled) {
                pending[index] = request;
                index += 1;
            }
        }

        return pending;
    }

    /// @return paidAlone_ number of payments that went through autonomously
    /// @return held_ number of payments held for review
    /// @return blocked_ number of payments hard-blocked (no funds moved)
    function autonomyRate() external view returns (uint256 paidAlone_, uint256 held_, uint256 blocked_) {
        paidAlone_ = paidAlone;
        held_ = heldCount;
        blocked_ = blockedCount;
    }

    function isAllowlisted(address account) external view returns (bool) {
        return _allowlisted[account];
    }

    function isDenylisted(address account) external view returns (bool) {
        return _denylisted[account];
    }

    function _deposit() internal {
        balance += msg.value;
        emit Deposited(owner, msg.value);
    }

    function _withdraw(uint256 amount) internal {
        if (balance < amount) revert InsufficientBalance(balance, amount);
        balance -= amount;

        _sendNative(owner, amount);
        emit Withdrawn(owner, amount);
    }

    function _createHeld(address payee, uint256 amount, string calldata reason, string memory ruleBroken) internal {
        uint256 id = _nextId;
        _nextId += 1;

        heldRequests[id] = HeldRequest({
            id: id,
            payee: payee,
            amount: amount,
            reason: reason,
            ruleBroken: ruleBroken,
            exists: true,
            settled: false
        });

        _heldIds.push(id);
        heldCount += 1;

        emit Held(id, payee, amount, reason, ruleBroken);
    }

    function _sendNative(address to, uint256 amount) internal {
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "NATIVE_TRANSFER_FAILED");
    }

    function _rollDayIfNeeded() internal {
        if (block.timestamp >= dayStart + 1 days) {
            dailySpent = 0;
            dayStart = block.timestamp;
        }
    }

    /// @dev Count payments within the last hour using the ring buffer. O(maxPerHour).
    function _recentPaymentsCount() internal view returns (uint256 count) {
        uint256 cap = _rateBuf.length;
        if (cap == 0) return 0;
        uint256 cutoff = block.timestamp > 1 hours ? block.timestamp - 1 hours : 0;
        uint256 n = _rateCount;
        uint256 head = _rateHead;
        for (uint256 i = 0; i < n; i++) {
            uint256 idx = (head + i) % cap;
            if (_rateBuf[idx] >= cutoff) {
                count += 1;
            }
        }
    }

    /// @dev Record a payment timestamp in the ring buffer. O(1) amortised.
    function _recordPaymentTimestamp(uint256 ts) internal {
        uint256 cap = _rateBuf.length;
        if (cap == 0) return;
        uint256 n = _rateCount;
        if (n < cap) {
            // Buffer not full yet: write to tail.
            _rateBuf[(_rateHead + n) % cap] = ts;
            _rateCount = n + 1;
        } else {
            // Buffer full: overwrite oldest slot and advance head.
            _rateBuf[_rateHead] = ts;
            _rateHead = (_rateHead + 1) % cap;
        }
    }

    function _addToPolicyAllowlist(address payee) internal {
        policy.allowlist.push(payee);
    }

    function _removeFromPolicyAllowlist(address payee) internal {
        uint256 length = policy.allowlist.length;
        for (uint256 i = 0; i < length; i++) {
            if (policy.allowlist[i] == payee) {
                policy.allowlist[i] = policy.allowlist[length - 1];
                policy.allowlist.pop();
                return;
            }
        }
    }

    function _addToPolicyDenylist(address payee) internal {
        policy.denylist.push(payee);
    }

    function _removeFromPolicyDenylist(address payee) internal {
        uint256 length = policy.denylist.length;
        for (uint256 i = 0; i < length; i++) {
            if (policy.denylist[i] == payee) {
                policy.denylist[i] = policy.denylist[length - 1];
                policy.denylist.pop();
                return;
            }
        }
    }
}
