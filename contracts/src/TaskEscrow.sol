// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title TaskEscrow
/// @notice USDC escrow for Levantate Bridge task marketplace on Arc testnet.
contract TaskEscrow is ReentrancyGuard {
    enum TaskState {
        Open,
        Bidding,
        Assigned,
        Submitted,
        Paid,
        Cancelled
    }

    struct Task {
        string description;
        uint256 maxBudget;
        uint256 bidDeadline;
        uint256 submissionWindow;
        uint256 submissionDeadline;
        uint256 round;
        TaskState state;
        address assignedWorker;
        uint256 winningBidId;
        uint256 winningBidAmount;
        bytes32 proofHash;
        uint256 currentRoundBidCount;
    }

    struct Bid {
        address worker;
        uint256 amount;
        uint256 round;
        bool exists;
    }

    IERC20 public immutable usdc;
    address public immutable agent;
    address public immutable relayer;

    uint256 public nextTaskId;
    uint256 public nextBidId;

    mapping(uint256 taskId => Task) public tasks;
    mapping(uint256 bidId => Bid) public bids;
    mapping(uint256 taskId => mapping(address worker => bool barred)) public barredWorkers;

    event TaskPosted(
        uint256 indexed taskId,
        address indexed agent,
        uint256 maxBudget,
        uint256 bidDeadline,
        uint256 submissionWindow,
        uint256 round,
        string description
    );

    event BidPlaced(
        uint256 indexed taskId,
        uint256 indexed bidId,
        address indexed worker,
        uint256 amount,
        uint256 round
    );

    event WorkerAssigned(
        uint256 indexed taskId,
        uint256 indexed bidId,
        address indexed worker,
        uint256 amount,
        uint256 submissionDeadline,
        uint256 round
    );

    event WorkSubmitted(
        uint256 indexed taskId,
        address indexed worker,
        bytes32 proofHash,
        uint256 round
    );

    event WorkRejected(
        uint256 indexed taskId,
        address indexed worker,
        uint256 newSubmissionDeadline,
        uint256 round
    );

    event PaymentReleased(
        uint256 indexed taskId,
        address indexed worker,
        address indexed agent,
        uint256 workerAmount,
        uint256 refundAmount,
        uint256 round
    );

    event TaskReclaimed(
        uint256 indexed taskId,
        address indexed worker,
        uint256 newRound,
        uint256 newBidDeadline
    );

    event TaskCancelled(
        uint256 indexed taskId,
        address indexed agent,
        uint256 refundAmount,
        uint256 round
    );

    error NotAgent();
    error NotRelayer();
    error InvalidState();
    error BidDeadlinePassed();
    error BidDeadlineNotReached();
    error SubmissionDeadlinePassed();
    error SubmissionDeadlineNotReached();
    error BidTooHigh();
    error WorkerBarred();
    error InvalidBid();
    error NoBidsInRound();
    error ZeroBudget();

    modifier onlyAgent() {
        if (msg.sender != agent) revert NotAgent();
        _;
    }

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address usdcToken, address agentAddress, address relayerAddress) {
        usdc = IERC20(usdcToken);
        agent = agentAddress;
        relayer = relayerAddress;
    }

    function postTask(
        string calldata description,
        uint256 maxBudget,
        uint256 bidDeadline,
        uint256 submissionWindow
    ) external onlyAgent returns (uint256 taskId) {
        if (maxBudget == 0) revert ZeroBudget();
        if (bidDeadline <= block.timestamp) revert BidDeadlinePassed();

        taskId = nextTaskId++;
        Task storage task = tasks[taskId];
        task.description = description;
        task.maxBudget = maxBudget;
        task.bidDeadline = bidDeadline;
        task.submissionWindow = submissionWindow;
        task.round = 0;
        task.state = TaskState.Open;

        bool ok = usdc.transferFrom(agent, address(this), maxBudget);
        require(ok, "USDC transfer failed");

        emit TaskPosted(
            taskId, agent, maxBudget, bidDeadline, submissionWindow, task.round, description
        );
    }

    function placeBid(uint256 taskId, address worker, uint256 amount)
        external
        onlyRelayer
        returns (uint256 bidId)
    {
        Task storage task = tasks[taskId];
        if (task.state != TaskState.Open && task.state != TaskState.Bidding) {
            revert InvalidState();
        }
        if (block.timestamp > task.bidDeadline) revert BidDeadlinePassed();
        if (amount == 0 || amount > task.maxBudget) revert BidTooHigh();
        if (barredWorkers[taskId][worker]) revert WorkerBarred();

        if (task.state == TaskState.Open) {
            task.state = TaskState.Bidding;
        }

        bidId = nextBidId++;
        bids[bidId] = Bid({worker: worker, amount: amount, round: task.round, exists: true});
        task.currentRoundBidCount++;

        emit BidPlaced(taskId, bidId, worker, amount, task.round);
    }

    function selectWinner(uint256 taskId, uint256 bidId) external onlyAgent {
        Task storage task = tasks[taskId];
        if (task.state != TaskState.Bidding) revert InvalidState();
        if (block.timestamp <= task.bidDeadline) revert BidDeadlineNotReached();

        Bid storage bid = bids[bidId];
        if (!bid.exists || bid.round != task.round) revert InvalidBid();

        task.state = TaskState.Assigned;
        task.assignedWorker = bid.worker;
        task.winningBidId = bidId;
        task.winningBidAmount = bid.amount;
        task.submissionDeadline = block.timestamp + task.submissionWindow;

        emit WorkerAssigned(
            taskId, bidId, bid.worker, bid.amount, task.submissionDeadline, task.round
        );
    }

    function submitWork(uint256 taskId, bytes32 proofHash) external onlyRelayer {
        Task storage task = tasks[taskId];
        if (task.state != TaskState.Assigned) revert InvalidState();
        if (block.timestamp > task.submissionDeadline) revert SubmissionDeadlinePassed();

        task.state = TaskState.Submitted;
        task.proofHash = proofHash;

        emit WorkSubmitted(taskId, task.assignedWorker, proofHash, task.round);
    }

    function approveWork(uint256 taskId) external onlyAgent nonReentrant {
        Task storage task = tasks[taskId];
        if (task.state != TaskState.Submitted) revert InvalidState();

        address worker = task.assignedWorker;
        uint256 workerAmount = task.winningBidAmount;
        uint256 refundAmount = task.maxBudget - workerAmount;

        task.state = TaskState.Paid;

        bool paidWorker = usdc.transfer(worker, workerAmount);
        require(paidWorker, "worker payout failed");
        if (refundAmount > 0) {
            bool refunded = usdc.transfer(agent, refundAmount);
            require(refunded, "agent refund failed");
        }

        emit PaymentReleased(taskId, worker, agent, workerAmount, refundAmount, task.round);
    }

    function rejectWork(uint256 taskId) external onlyAgent {
        Task storage task = tasks[taskId];
        if (task.state != TaskState.Submitted) revert InvalidState();

        task.state = TaskState.Assigned;
        task.proofHash = bytes32(0);
        task.submissionDeadline = block.timestamp + task.submissionWindow;

        emit WorkRejected(taskId, task.assignedWorker, task.submissionDeadline, task.round);
    }

    function reclaimTask(uint256 taskId, uint256 newBidDeadline) external onlyAgent {
        Task storage task = tasks[taskId];
        if (task.state != TaskState.Assigned) revert InvalidState();
        if (block.timestamp <= task.submissionDeadline) revert SubmissionDeadlineNotReached();
        if (newBidDeadline <= block.timestamp) revert BidDeadlinePassed();

        address defaultingWorker = task.assignedWorker;
        barredWorkers[taskId][defaultingWorker] = true;

        task.round++;
        task.state = TaskState.Open;
        task.bidDeadline = newBidDeadline;
        task.submissionDeadline = 0;
        task.assignedWorker = address(0);
        task.winningBidId = 0;
        task.winningBidAmount = 0;
        task.proofHash = bytes32(0);
        task.currentRoundBidCount = 0;

        emit TaskReclaimed(taskId, defaultingWorker, task.round, newBidDeadline);
    }

    function cancelTask(uint256 taskId) external onlyAgent nonReentrant {
        Task storage task = tasks[taskId];
        if (task.state != TaskState.Open && task.state != TaskState.Bidding) {
            revert InvalidState();
        }
        if (block.timestamp <= task.bidDeadline) revert BidDeadlineNotReached();
        if (task.currentRoundBidCount != 0) revert NoBidsInRound();

        uint256 refundAmount = task.maxBudget;
        task.state = TaskState.Cancelled;

        bool refunded = usdc.transfer(agent, refundAmount);
        require(refunded, "cancel refund failed");

        emit TaskCancelled(taskId, agent, refundAmount, task.round);
    }
}
