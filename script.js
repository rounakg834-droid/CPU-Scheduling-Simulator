const state = {
  processes: [],
  lastResult: null,
};

const elements = {
  processForm: document.getElementById('process-form'),
  pid: document.getElementById('pid'),
  arrival: document.getElementById('arrival'),
  burst: document.getElementById('burst'),
  priority: document.getElementById('priority'),
  algorithm: document.getElementById('algorithm'),
  quantumField: document.getElementById('quantum-field'),
  quantum: document.getElementById('quantum'),
  processTable: document.getElementById('process-table-body'),
  resultsTable: document.getElementById('results-table-body'),
  gantt: document.getElementById('gantt-chart'),
  message: document.getElementById('message'),
  averageWaiting: document.getElementById('avg-waiting'),
  averageTurnaround: document.getElementById('avg-turnaround'),
  cpuUtilization: document.getElementById('cpu-utilization'),
  totalTime: document.getElementById('total-time'),
};

const PROCESS_COLORS = ['#38bdf8', '#22c55e', '#f59e0b', '#f472b6', '#a78bfa', '#fb7185', '#34d399', '#facc15'];

function showMessage(text, type = '') {
  elements.message.textContent = text;
  elements.message.className = `status-message ${type}`.trim();
}

function createCell(row, value) {
  const cell = document.createElement('td');
  cell.textContent = String(value);
  row.appendChild(cell);
  return cell;
}

function appendEmptyRow(tableBody, message, columnCount) {
  const row = document.createElement('tr');
  const cell = createCell(row, message);
  cell.colSpan = columnCount;
  cell.className = 'empty-state';
  tableBody.replaceChildren(row);
}

function clearResults(message = 'Run a simulation to view process metrics.') {
  state.lastResult = null;
  elements.averageWaiting.textContent = '0.00';
  elements.averageTurnaround.textContent = '0.00';
  elements.cpuUtilization.textContent = '0%';
  elements.totalTime.textContent = '0';
  elements.gantt.replaceChildren();
  const emptyChart = document.createElement('div');
  emptyChart.className = 'empty-state';
  emptyChart.textContent = 'No simulation results yet.';
  elements.gantt.appendChild(emptyChart);
  appendEmptyRow(elements.resultsTable, message, 6);
}

function parseProcessInput() {
  return {
    id: elements.pid.value.trim(),
    arrival: elements.arrival.valueAsNumber,
    burst: elements.burst.valueAsNumber,
    priority: elements.priority.valueAsNumber,
  };
}

function validateProcess(process) {
  if (!process.id) {
    return 'Process ID is required.';
  }
  if (!Number.isFinite(process.arrival) || process.arrival < 0) {
    return 'Arrival time must be a valid number greater than or equal to 0.';
  }
  if (!Number.isFinite(process.burst) || process.burst <= 0) {
    return 'Burst time must be a valid number greater than 0.';
  }
  if (!Number.isFinite(process.priority) || process.priority < 0) {
    return 'Priority must be a valid number greater than or equal to 0.';
  }
  if (state.processes.some((item) => item.id.toLocaleLowerCase() === process.id.toLocaleLowerCase())) {
    return `Process ID "${process.id}" already exists.`;
  }
  return null;
}

function addProcess(event) {
  event.preventDefault();
  const process = parseProcessInput();
  const error = validateProcess(process);
  if (error) {
    showMessage(error, 'error');
    return;
  }

  process.sequence = state.processes.length
    ? Math.max(...state.processes.map((item) => item.sequence)) + 1
    : 0;
  state.processes.push(process);
  renderProcessTable();
  clearResults();
  showMessage(`Process ${process.id} added successfully.`, 'success');
  elements.processForm.reset();
  elements.pid.focus();
}

function removeProcess(processId) {
  state.processes = state.processes.filter((process) => process.id !== processId);
  renderProcessTable();
  clearResults();
  showMessage(`Process ${processId} removed.`, 'success');
}

function renderProcessTable() {
  if (!state.processes.length) {
    appendEmptyRow(elements.processTable, 'No processes added yet.', 5);
    return;
  }

  const rows = state.processes.map((process) => {
    const row = document.createElement('tr');
    createCell(row, process.id);
    createCell(row, process.arrival);
    createCell(row, process.burst);
    createCell(row, process.priority);
    const actionCell = document.createElement('td');
    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.className = 'remove-btn';
    removeButton.textContent = 'Remove';
    removeButton.setAttribute('aria-label', `Remove process ${process.id}`);
    removeButton.addEventListener('click', () => removeProcess(process.id));
    actionCell.appendChild(removeButton);
    row.appendChild(actionCell);
    return row;
  });

  elements.processTable.replaceChildren(...rows);
}

function sortByArrivalAndInputOrder(a, b) {
  return a.arrival - b.arrival || a.sequence - b.sequence;
}

function sortByReadyPriority(a, b, prioritySelector) {
  return prioritySelector(a) - prioritySelector(b)
    || a.arrival - b.arrival
    || a.sequence - b.sequence;
}

function makeProcessState(process) {
  return {
    ...process,
    remaining: process.burst,
    completionTime: null,
    firstCPUStart: null,
  };
}

function runNonPreemptive(processes, algorithm, segments, recordExecution) {
  const pending = [...processes];
  let currentTime = 0;

  while (pending.length) {
    const available = pending.filter((process) => process.arrival <= currentTime);
    if (!available.length) {
      const nextArrival = Math.min(...pending.map((process) => process.arrival));
      if (nextArrival > currentTime) {
        segments.push({ processId: null, start: currentTime, end: nextArrival });
      }
      currentTime = nextArrival;
      continue;
    }

    let process;
    if (algorithm === 'FCFS') {
      process = available.sort(sortByArrivalAndInputOrder)[0];
    } else if (algorithm === 'SJF') {
      process = available.sort((a, b) => sortByReadyPriority(a, b, (item) => item.burst))[0];
    } else {
      process = available.sort((a, b) => sortByReadyPriority(a, b, (item) => item.priority))[0];
    }

    pending.splice(pending.indexOf(process), 1);
    const start = currentTime;
    const end = start + process.burst;
    segments.push({ processId: process.id, start, end });
    recordExecution(process, start, end);
    process.completionTime = end;
    currentTime = end;
  }

  return currentTime;
}

function runRoundRobin(processes, quantum, segments, recordExecution) {
  const arrivals = [...processes].sort(sortByArrivalAndInputOrder);
  const readyQueue = [];
  let nextProcess = 0;
  let completed = 0;
  let currentTime = 0;

  while (completed < arrivals.length) {
    while (nextProcess < arrivals.length && arrivals[nextProcess].arrival <= currentTime) {
      readyQueue.push(arrivals[nextProcess]);
      nextProcess += 1;
    }

    if (!readyQueue.length) {
      const nextArrival = arrivals[nextProcess].arrival;
      if (nextArrival > currentTime) {
        segments.push({ processId: null, start: currentTime, end: nextArrival });
      }
      currentTime = nextArrival;
      continue;
    }

    const process = readyQueue.shift();
    const start = currentTime;
    const end = start + Math.min(process.remaining, quantum);
    segments.push({ processId: process.id, start, end });
    recordExecution(process, start, end);
    process.remaining -= end - start;
    currentTime = end;

    while (nextProcess < arrivals.length && arrivals[nextProcess].arrival <= currentTime) {
      readyQueue.push(arrivals[nextProcess]);
      nextProcess += 1;
    }

    if (process.remaining > 0) {
      readyQueue.push(process);
    } else {
      process.completionTime = currentTime;
      completed += 1;
    }
  }

  return currentTime;
}

function buildSchedule(inputProcesses, algorithm, quantum) {
  const processes = inputProcesses.map(makeProcessState);
  const segments = [];
  const recordExecution = (process, start) => {
    if (process.firstCPUStart === null) {
      process.firstCPUStart = start;
    }
  };

  const totalTime = algorithm === 'RR'
    ? runRoundRobin(processes, quantum, segments, recordExecution)
    : runNonPreemptive(processes, algorithm, segments, recordExecution);

  const results = processes.map((process) => {
    const turnaroundTime = process.completionTime - process.arrival;
    return {
      id: process.id,
      arrival: process.arrival,
      burst: process.burst,
      completionTime: process.completionTime,
      turnaroundTime,
      waitingTime: turnaroundTime - process.burst,
      responseTime: process.firstCPUStart - process.arrival,
      firstCPUStart: process.firstCPUStart,
    };
  });
  const totalBurst = results.reduce((sum, process) => sum + process.burst, 0);

  return {
    segments: segments.map((segment, index) => ({
      ...segment,
      color: segment.processId === null
        ? null
        : PROCESS_COLORS[processes.findIndex((process) => process.id === segment.processId) % PROCESS_COLORS.length],
      index,
    })),
    results,
    averageWaiting: results.reduce((sum, process) => sum + process.waitingTime, 0) / results.length,
    averageTurnaround: results.reduce((sum, process) => sum + process.turnaroundTime, 0) / results.length,
    cpuUtilization: totalTime ? (totalBurst / totalTime) * 100 : 0,
    totalTime,
  };
}

function renderGanttChart(result) {
  const row = document.createElement('div');
  row.className = 'gantt-row';
  const totalTime = Math.max(result.totalTime, 1);

  result.segments.forEach((segment) => {
    const width = ((segment.end - segment.start) / totalTime) * 100;
    const block = document.createElement('div');
    block.className = `gantt-segment${segment.processId === null ? ' idle-segment' : ''}`;
    block.style.width = `${width}%`;
    if (segment.color) {
      block.style.backgroundColor = segment.color;
    }
    block.title = `${segment.processId ?? 'Idle'}: ${segment.start} - ${segment.end}`;

    const processLabel = document.createElement('span');
    processLabel.textContent = segment.processId ?? 'Idle';
    const timeLabel = document.createElement('span');
    timeLabel.className = 'segment-range';
    timeLabel.textContent = `[${segment.start}, ${segment.end}]`;
    block.append(processLabel, timeLabel);
    row.appendChild(block);
  });

  elements.gantt.replaceChildren(row);
}

function renderResults(result) {
  renderGanttChart(result);
  elements.averageWaiting.textContent = result.averageWaiting.toFixed(2);
  elements.averageTurnaround.textContent = result.averageTurnaround.toFixed(2);
  elements.cpuUtilization.textContent = `${result.cpuUtilization.toFixed(2)}%`;
  elements.totalTime.textContent = String(result.totalTime);

  const rows = result.results.map((process) => {
    const row = document.createElement('tr');
    createCell(row, process.id);
    createCell(row, process.firstCPUStart);
    createCell(row, process.completionTime);
    createCell(row, process.turnaroundTime.toFixed(2));
    createCell(row, process.waitingTime.toFixed(2));
    createCell(row, process.responseTime.toFixed(2));
    return row;
  });
  elements.resultsTable.replaceChildren(...rows);
}

function setQuantumVisibility() {
  elements.quantumField.classList.toggle('hidden', elements.algorithm.value !== 'RR');
}

function runSimulation() {
  if (!state.processes.length) {
    showMessage('Add at least one process before running the simulation.', 'error');
    return;
  }

  const algorithm = elements.algorithm.value;
  const quantum = elements.quantum.valueAsNumber;
  if (algorithm === 'RR' && (!Number.isFinite(quantum) || quantum <= 0)) {
    showMessage('Round Robin requires a valid time quantum greater than 0.', 'error');
    return;
  }

  const result = buildSchedule(state.processes, algorithm, quantum);
  state.lastResult = result;
  renderResults(result);
  showMessage(`${algorithm === 'RR' ? 'Round Robin' : algorithm} simulation completed successfully.`, 'success');
}

function resetSimulation() {
  state.processes = [];
  elements.processForm.reset();
  renderProcessTable();
  clearResults();
  showMessage('All processes and results have been reset.', 'success');
}

elements.processForm.addEventListener('submit', addProcess);
elements.algorithm.addEventListener('change', () => {
  setQuantumVisibility();
  if (state.lastResult) {
    clearResults('Run simulation to calculate results for the selected algorithm.');
    showMessage('Algorithm changed. Run the simulation to update results.');
  }
});
elements.quantum.addEventListener('input', () => {
  if (state.lastResult) {
    clearResults('Run simulation to calculate results for the current time quantum.');
    showMessage('Time quantum changed. Run the simulation to update results.');
  }
});
document.getElementById('run-simulation').addEventListener('click', runSimulation);
document.getElementById('reset-processes').addEventListener('click', resetSimulation);

setQuantumVisibility();
renderProcessTable();
clearResults();
