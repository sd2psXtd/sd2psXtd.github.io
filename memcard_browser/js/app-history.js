export class SnapshotHistory {
  constructor(getCapacityFn) {
    this.getCapacity = getCapacityFn;
    this.reset();
  }

  reset() {
    this.undoStack = [];
    this.redoStack = [];
    this.actionLabels = [];
    this.actionIndex = 0;
  }

  canUndo() {
    return this.undoStack.length > 0;
  }

  canRedo() {
    return this.redoStack.length > 0;
  }

  getPendingLabels() {
    return this.actionLabels.slice(0, this.actionIndex);
  }

  record(label, beforeSnapshot) {
    this.pushUndo(beforeSnapshot);
    this.redoStack = [];
    if (this.actionIndex < this.actionLabels.length) {
      this.actionLabels = this.actionLabels.slice(0, this.actionIndex);
    }
    this.actionLabels.push(label);
    this.actionIndex += 1;
  }

  undo(currentSnapshot) {
    if (!this.canUndo()) return null;
    const previous = this.undoStack.pop();
    this.pushRedo(currentSnapshot);
    this.actionIndex = Math.max(0, this.actionIndex - 1);
    return previous;
  }

  redo(currentSnapshot) {
    if (!this.canRedo()) return null;
    const next = this.redoStack.pop();
    this.pushUndo(currentSnapshot);
    this.actionIndex = Math.min(this.actionLabels.length, this.actionIndex + 1);
    return next;
  }

  pushUndo(snapshot) {
    this.undoStack.push(snapshot);
    this.trimToCapacity(this.undoStack);
  }

  pushRedo(snapshot) {
    this.redoStack.push(snapshot);
    this.trimToCapacity(this.redoStack);
  }

  trimToCapacity(stack) {
    const cap = this.getCapacity();
    while (stack.length > cap) {
      stack.shift();
    }
  }
}
