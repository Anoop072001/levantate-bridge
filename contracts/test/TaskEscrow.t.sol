// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Test, Vm} from "forge-std/Test.sol";
import {TaskEscrow} from "../src/TaskEscrow.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TaskEscrowTest is Test {
    MockUSDC internal usdc;
    TaskEscrow internal escrow;

    address internal agent = makeAddr("agent");
    address internal relayer = makeAddr("relayer");
    address internal worker1 = makeAddr("worker1");
    address internal worker2 = makeAddr("worker2");

    uint256 internal constant BUDGET = 1_000_000; // 1 USDC
    uint256 internal constant SUBMISSION_WINDOW = 1 days;

    function setUp() public {
        usdc = new MockUSDC();
        escrow = new TaskEscrow(address(usdc), agent, relayer);
        usdc.mint(agent, 10_000_000);
    }

    function _approveAgent(uint256 amount) internal {
        vm.prank(agent);
        usdc.approve(address(escrow), amount);
    }

    function _postTask(uint256 bidOffset, uint256 budget) internal returns (uint256 taskId) {
        _approveAgent(budget);
        vm.prank(agent);
        taskId = escrow.postTask("collect complaints", budget, block.timestamp + bidOffset, SUBMISSION_WINDOW);
    }

    function _placeBid(uint256 taskId, address worker, uint256 amount) internal returns (uint256 bidId) {
        vm.prank(relayer);
        bidId = escrow.placeBid(taskId, worker, amount);
    }

    function test_happyPath_fullLifecycle() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bidId = _placeBid(taskId, worker1, 600_000);

        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bidId);

        bytes32 proof = keccak256("proof");
        vm.prank(relayer);
        escrow.submitWork(taskId, proof);

        vm.prank(agent);
        escrow.approveWork(taskId);

        assertEq(uint8(_taskState(taskId)), uint8(TaskEscrow.TaskState.Paid));
        assertEq(usdc.balanceOf(worker1), 600_000);
        assertEq(usdc.balanceOf(agent), 10_000_000 - 600_000);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_rejectWork_resubmit_approve() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bidId = _placeBid(taskId, worker1, 500_000);

        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bidId);

        vm.prank(relayer);
        escrow.submitWork(taskId, keccak256("bad"));

        vm.warp(block.timestamp + 1 hours);
        uint256 rejectTime = block.timestamp;
        vm.prank(agent);
        escrow.rejectWork(taskId);

        (, , , , uint256 deadlineAfter, , , , , , ,) = _task(taskId);
        assertEq(deadlineAfter, rejectTime + SUBMISSION_WINDOW);
        assertEq(uint8(_taskState(taskId)), uint8(TaskEscrow.TaskState.Assigned));

        vm.prank(relayer);
        escrow.submitWork(taskId, keccak256("good"));

        vm.prank(agent);
        escrow.approveWork(taskId);

        assertEq(usdc.balanceOf(worker1), 500_000);
    }

    function test_reclaimCycle_roundTwoPaysDifferentWorker() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bid1 = _placeBid(taskId, worker1, 700_000);

        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bid1);

        vm.warp(block.timestamp + SUBMISSION_WINDOW + 1);
        vm.prank(agent);
        escrow.reclaimTask(taskId, block.timestamp + 2 hours);

        uint256 bid2 = _placeBid(taskId, worker2, 650_000);

        vm.warp(block.timestamp + 2 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bid2);

        vm.prank(relayer);
        escrow.submitWork(taskId, keccak256("round2"));

        vm.prank(agent);
        escrow.approveWork(taskId);

        assertEq(usdc.balanceOf(worker1), 0);
        assertEq(usdc.balanceOf(worker2), 650_000);
        assertEq(usdc.balanceOf(address(escrow)), 0);
    }

    function test_cancelTask_refundsMaxBudget() public {
        uint256 agentBefore = usdc.balanceOf(agent);
        uint256 taskId = _postTask(1 hours, BUDGET);

        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.cancelTask(taskId);

        assertEq(usdc.balanceOf(agent), agentBefore);
        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(_taskState(taskId)), uint8(TaskEscrow.TaskState.Cancelled));
    }

    function test_cancelTask_afterReclaim_withNoRoundTwoBids() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bid1 = _placeBid(taskId, worker1, 700_000);

        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bid1);

        vm.warp(block.timestamp + SUBMISSION_WINDOW + 1);
        vm.prank(agent);
        escrow.reclaimTask(taskId, block.timestamp + 2 hours);

        vm.warp(block.timestamp + 2 hours + 1);
        vm.prank(agent);
        escrow.cancelTask(taskId);

        assertEq(usdc.balanceOf(address(escrow)), 0);
        assertEq(uint8(_taskState(taskId)), uint8(TaskEscrow.TaskState.Cancelled));
    }

    function test_revert_bidOverBudget() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        vm.prank(relayer);
        vm.expectRevert(TaskEscrow.BidTooHigh.selector);
        escrow.placeBid(taskId, worker1, BUDGET + 1);
    }

    function test_revert_bidAfterBidDeadline() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(relayer);
        vm.expectRevert(TaskEscrow.BidDeadlinePassed.selector);
        escrow.placeBid(taskId, worker1, 500_000);
    }

    function test_revert_selectWinnerBeforeBidDeadline() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bidId = _placeBid(taskId, worker1, 500_000);
        vm.prank(agent);
        vm.expectRevert(TaskEscrow.BidDeadlineNotReached.selector);
        escrow.selectWinner(taskId, bidId);
    }

    function test_revert_submitWorkAfterSubmissionDeadline() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bidId = _placeBid(taskId, worker1, 500_000);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bidId);
        vm.warp(block.timestamp + SUBMISSION_WINDOW + 1);
        vm.prank(relayer);
        vm.expectRevert(TaskEscrow.SubmissionDeadlinePassed.selector);
        escrow.submitWork(taskId, keccak256("late"));
    }

    function test_revert_reclaimBeforeSubmissionDeadline() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bidId = _placeBid(taskId, worker1, 500_000);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bidId);
        vm.prank(agent);
        vm.expectRevert(TaskEscrow.SubmissionDeadlineNotReached.selector);
        escrow.reclaimTask(taskId, block.timestamp + 2 hours);
    }

    function test_revert_reclaimOnSubmittedTask() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bidId = _placeBid(taskId, worker1, 500_000);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bidId);
        vm.prank(relayer);
        escrow.submitWork(taskId, keccak256("done"));
        vm.warp(block.timestamp + SUBMISSION_WINDOW + 1);
        vm.prank(agent);
        vm.expectRevert(TaskEscrow.InvalidState.selector);
        escrow.reclaimTask(taskId, block.timestamp + 2 hours);
    }

    function test_revert_barredWorkerRebid() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bid1 = _placeBid(taskId, worker1, 700_000);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bid1);
        vm.warp(block.timestamp + SUBMISSION_WINDOW + 1);
        vm.prank(agent);
        escrow.reclaimTask(taskId, block.timestamp + 2 hours);

        vm.prank(relayer);
        vm.expectRevert(TaskEscrow.WorkerBarred.selector);
        escrow.placeBid(taskId, worker1, 600_000);
    }

    function test_revert_nonAgentSelectWinner() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bidId = _placeBid(taskId, worker1, 500_000);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(relayer);
        vm.expectRevert(TaskEscrow.NotAgent.selector);
        escrow.selectWinner(taskId, bidId);
    }

    function test_revert_nonAgentApproveWork() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bidId = _placeBid(taskId, worker1, 500_000);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bidId);
        vm.prank(relayer);
        escrow.submitWork(taskId, keccak256("x"));
        vm.prank(relayer);
        vm.expectRevert(TaskEscrow.NotAgent.selector);
        escrow.approveWork(taskId);
    }

    function test_revert_nonAgentReclaimTask() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bidId = _placeBid(taskId, worker1, 500_000);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bidId);
        vm.warp(block.timestamp + SUBMISSION_WINDOW + 1);
        vm.prank(relayer);
        vm.expectRevert(TaskEscrow.NotAgent.selector);
        escrow.reclaimTask(taskId, block.timestamp + 2 hours);
    }

    function test_revert_nonRelayerPlaceBid() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        vm.prank(worker1);
        vm.expectRevert(TaskEscrow.NotRelayer.selector);
        escrow.placeBid(taskId, worker1, 500_000);
    }

    function test_revert_doubleApprove() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bidId = _placeBid(taskId, worker1, 500_000);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bidId);
        vm.prank(relayer);
        escrow.submitWork(taskId, keccak256("x"));
        vm.prank(agent);
        escrow.approveWork(taskId);
        vm.prank(agent);
        vm.expectRevert(TaskEscrow.InvalidState.selector);
        escrow.approveWork(taskId);
    }

    function test_everyTransitionEmitsEvent() public {
        vm.recordLogs();
        uint256 taskId = _postTask(1 hours, BUDGET);
        _assertEventTopic(keccak256(
            "TaskPosted(uint256,address,uint256,uint256,uint256,uint256,string)"
        ));

        uint256 bidId = _placeBid(taskId, worker1, 500_000);
        _assertEventTopic(keccak256("BidPlaced(uint256,uint256,address,uint256,uint256)"));
        assertEq(bidId, 0);

        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bidId);
        _assertEventTopic(keccak256(
            "WorkerAssigned(uint256,uint256,address,uint256,uint256,uint256)"
        ));

        vm.prank(relayer);
        escrow.submitWork(taskId, keccak256("proof"));
        _assertEventTopic(keccak256("WorkSubmitted(uint256,address,bytes32,uint256)"));

        vm.prank(agent);
        escrow.rejectWork(taskId);
        _assertEventTopic(keccak256("WorkRejected(uint256,address,uint256,uint256)"));

        vm.prank(relayer);
        escrow.submitWork(taskId, keccak256("proof2"));
        _assertEventTopic(keccak256("WorkSubmitted(uint256,address,bytes32,uint256)"));

        vm.prank(agent);
        escrow.approveWork(taskId);
        _assertEventTopic(keccak256(
            "PaymentReleased(uint256,address,address,uint256,uint256,uint256)"
        ));
    }

    function test_reclaimAndCancelEmitEvents() public {
        uint256 taskId = _postTask(1 hours, BUDGET);
        uint256 bidId = _placeBid(taskId, worker1, 500_000);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(agent);
        escrow.selectWinner(taskId, bidId);
        vm.warp(block.timestamp + SUBMISSION_WINDOW + 1);

        vm.recordLogs();
        vm.prank(agent);
        escrow.reclaimTask(taskId, block.timestamp + 2 hours);
        _assertEventTopic(keccak256("TaskReclaimed(uint256,address,uint256,uint256)"));

        vm.warp(block.timestamp + 2 hours + 1);
        vm.recordLogs();
        vm.prank(agent);
        escrow.cancelTask(taskId);
        _assertEventTopic(keccak256("TaskCancelled(uint256,address,uint256,uint256)"));
    }

    function _taskState(uint256 taskId) internal view returns (TaskEscrow.TaskState state) {
        (, , , , , , state, , , , ,) = _task(taskId);
    }

    function _task(uint256 taskId)
        internal
        view
        returns (
            string memory description,
            uint256 maxBudget,
            uint256 bidDeadline,
            uint256 submissionWindow,
            uint256 submissionDeadline,
            uint256 round,
            TaskEscrow.TaskState state,
            address assignedWorker,
            uint256 winningBidId,
            uint256 winningBidAmount,
            bytes32 proofHash,
            uint256 currentRoundBidCount
        )
    {
        (
            description,
            maxBudget,
            bidDeadline,
            submissionWindow,
            submissionDeadline,
            round,
            state,
            assignedWorker,
            winningBidId,
            winningBidAmount,
            proofHash,
            currentRoundBidCount
        ) = escrow.tasks(taskId);
    }

    function _assertEventTopic(bytes32 topic) internal {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == topic) {
                found = true;
                break;
            }
        }
        assertTrue(found);
        vm.recordLogs();
    }
}
