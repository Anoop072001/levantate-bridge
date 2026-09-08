import {
  BidPlaced as BidPlacedEvent,
  PaymentReleased as PaymentReleasedEvent,
  TaskCancelled as TaskCancelledEvent,
  TaskPosted as TaskPostedEvent,
  TaskReclaimed as TaskReclaimedEvent,
  WorkerAssigned as WorkerAssignedEvent,
  WorkRejected as WorkRejectedEvent,
  WorkSubmitted as WorkSubmittedEvent,
} from "../generated/TaskEscrow/TaskEscrow";
import { Bid, MissedDeadline, Payment, Task, Worker } from "../generated/schema";
import { BigDecimal, BigInt, Bytes } from "@graphprotocol/graph-ts";

const ZERO_BD = BigDecimal.fromString("0");

function workerId(address: Bytes): string {
  return address.toHexString().toLowerCase();
}

function loadOrCreateWorker(address: Bytes): Worker {
  const id = workerId(address);
  let worker = Worker.load(id);
  if (worker == null) {
    worker = new Worker(id);
    worker.address = address;
    worker.tasksAssigned = 0;
    worker.tasksPaid = 0;
    worker.missedDeadlines = 0;
    worker.completionRate = ZERO_BD;
  }
  return worker;
}

function completionRate(tasksAssigned: i32, tasksPaid: i32): BigDecimal {
  if (tasksAssigned == 0) return ZERO_BD;
  return BigDecimal.fromString(tasksPaid.toString()).div(
    BigDecimal.fromString(tasksAssigned.toString()),
  );
}

export function handleTaskPosted(event: TaskPostedEvent): void {
  const id = event.params.taskId.toString();
  const task = new Task(id);
  task.description = event.params.description;
  task.maxBudget = event.params.maxBudget;
  task.bidDeadline = event.params.bidDeadline;
  task.submissionWindow = event.params.submissionWindow;
  task.submissionDeadline = BigInt.zero();
  task.round = event.params.round.toI32();
  task.state = "Open";
  task.agent = event.params.agent;
  task.winningBidAmount = BigInt.zero();
  task.createdAt = event.block.timestamp;
  task.updatedAt = event.block.timestamp;
  task.transactionHash = event.transaction.hash;
  task.blockTimestamp = event.block.timestamp;
  task.save();
}

export function handleBidPlaced(event: BidPlacedEvent): void {
  const task = Task.load(event.params.taskId.toString());
  if (task == null) return;

  if (task.state == "Open") {
    task.state = "Bidding";
    task.updatedAt = event.block.timestamp;
    task.transactionHash = event.transaction.hash;
    task.blockTimestamp = event.block.timestamp;
    task.save();
  }

  const bid = new Bid(event.params.bidId.toString());
  bid.task = task.id;
  bid.worker = workerId(event.params.worker);
  bid.amount = event.params.amount;
  bid.round = event.params.round.toI32();
  bid.createdAt = event.block.timestamp;
  bid.transactionHash = event.transaction.hash;
  bid.blockTimestamp = event.block.timestamp;
  bid.save();

  loadOrCreateWorker(event.params.worker).save();
}

export function handleWorkerAssigned(event: WorkerAssignedEvent): void {
  const task = Task.load(event.params.taskId.toString());
  if (task == null) return;

  task.state = "Assigned";
  task.submissionDeadline = event.params.submissionDeadline;
  task.round = event.params.round.toI32();
  task.winningBidAmount = event.params.amount;
  task.winningBid = event.params.bidId.toString();
  task.updatedAt = event.block.timestamp;
  task.transactionHash = event.transaction.hash;
  task.blockTimestamp = event.block.timestamp;

  const worker = loadOrCreateWorker(event.params.worker);
  worker.tasksAssigned = worker.tasksAssigned + 1;
  worker.completionRate = completionRate(worker.tasksAssigned, worker.tasksPaid);
  worker.save();

  task.assignedWorker = worker.id;
  task.save();
}

export function handleWorkSubmitted(event: WorkSubmittedEvent): void {
  const task = Task.load(event.params.taskId.toString());
  if (task == null) return;

  task.state = "Submitted";
  task.proofHash = event.params.proofHash;
  task.round = event.params.round.toI32();
  task.updatedAt = event.block.timestamp;
  task.transactionHash = event.transaction.hash;
  task.blockTimestamp = event.block.timestamp;
  task.save();
}

export function handleWorkRejected(event: WorkRejectedEvent): void {
  const task = Task.load(event.params.taskId.toString());
  if (task == null) return;

  task.state = "Assigned";
  task.submissionDeadline = event.params.newSubmissionDeadline;
  task.proofHash = null;
  task.round = event.params.round.toI32();
  task.updatedAt = event.block.timestamp;
  task.transactionHash = event.transaction.hash;
  task.blockTimestamp = event.block.timestamp;
  task.save();
}

export function handlePaymentReleased(event: PaymentReleasedEvent): void {
  const task = Task.load(event.params.taskId.toString());
  if (task == null) return;

  const paymentId = event.transaction.hash.toHexString() + "-" + event.params.taskId.toString();
  const payment = new Payment(paymentId);
  payment.task = task.id;
  payment.worker = workerId(event.params.worker);
  payment.agent = event.params.agent;
  payment.workerAmount = event.params.workerAmount;
  payment.refundAmount = event.params.refundAmount;
  payment.round = event.params.round.toI32();
  payment.transactionHash = event.transaction.hash;
  payment.blockTimestamp = event.block.timestamp;
  payment.save();

  task.state = "Paid";
  task.round = event.params.round.toI32();
  task.updatedAt = event.block.timestamp;
  task.transactionHash = event.transaction.hash;
  task.blockTimestamp = event.block.timestamp;
  task.save();

  const worker = loadOrCreateWorker(event.params.worker);
  worker.tasksPaid = worker.tasksPaid + 1;
  worker.completionRate = completionRate(worker.tasksAssigned, worker.tasksPaid);
  worker.save();
}

export function handleTaskReclaimed(event: TaskReclaimedEvent): void {
  const task = Task.load(event.params.taskId.toString());
  if (task == null) return;

  const recordId = event.transaction.hash.toHexString() + "-" + event.params.taskId.toString();
  const record = new MissedDeadline(recordId);
  record.task = task.id;
  record.worker = workerId(event.params.worker);
  record.newRound = event.params.newRound.toI32();
  record.newBidDeadline = event.params.newBidDeadline;
  record.transactionHash = event.transaction.hash;
  record.blockTimestamp = event.block.timestamp;
  record.save();

  const worker = loadOrCreateWorker(event.params.worker);
  worker.missedDeadlines = worker.missedDeadlines + 1;
  worker.completionRate = completionRate(worker.tasksAssigned, worker.tasksPaid);
  worker.save();

  task.state = "Open";
  task.round = event.params.newRound.toI32();
  task.bidDeadline = event.params.newBidDeadline;
  task.submissionDeadline = BigInt.zero();
  task.winningBidAmount = BigInt.zero();
  task.proofHash = null;
  task.updatedAt = event.block.timestamp;
  task.transactionHash = event.transaction.hash;
  task.blockTimestamp = event.block.timestamp;
  task.save();
}

export function handleTaskCancelled(event: TaskCancelledEvent): void {
  const task = Task.load(event.params.taskId.toString());
  if (task == null) return;

  task.state = "Cancelled";
  task.round = event.params.round.toI32();
  task.updatedAt = event.block.timestamp;
  task.transactionHash = event.transaction.hash;
  task.blockTimestamp = event.block.timestamp;
  task.save();
}
