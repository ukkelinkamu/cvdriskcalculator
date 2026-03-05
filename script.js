const riskCore = window.RiskCore;

if (!riskCore) {
  throw new Error('Risk calculation utilities failed to load.');
}

const { clampProbability, calculateFinrisk, calculatePreventTotalCvd } = riskCore;

const riskModels = {
  finrisk: {
    id: 'finrisk',
    name: 'FINRISK',
    description:
      'FINRISK estimates 10-year risk of major coronary events and stroke using Finnish cohort data.',
    calculate(inputs) {
      return calculateFinrisk(inputs);
    },
  },
  riskcalculator: {
    id: 'riskcalculator',
    name: 'PREVENT Total CVD',
    description:
      'PREVENT Total CVD relies on U.S. cohort data and expands on the pooled cohort equations to estimate 10-year cardiovascular risk.',
    calculate(inputs) {
      return calculatePreventTotalCvd(inputs);
    },
  },
};

const treatmentStrategies = [
  { id: 'baseline', label: 'No pharmacotherapy', multiplier: 1 },
  { id: 'bp1', label: 'One blood pressure medication', multiplier: 0.9 },
  { id: 'bp2', label: 'Two blood pressure medications', multiplier: 0.9 * 0.9 },
  { id: 'statin', label: 'Statin therapy', multiplier: 0.75 },
  {
    id: 'bp1Statin',
    label: 'One blood pressure medication + statin',
    multiplier: 0.9 * 0.75,
  },
  {
    id: 'combo',
    label: 'Two blood pressure medications + statin',
    multiplier: 0.9 * 0.9 * 0.75,
  },
];

const chartColours = {
  background: ['#0c8fd6', '#0fa4b9', '#0bb47d', '#f3a712', '#ef476f', '#7353ba'],
  border: ['#086394', '#0b7382', '#087955', '#c67f0d', '#c23a59', '#54348d'],
};

let chartInstance;
let chartUnavailableNotice;
let latestTreatmentResults = [];
let latestBaselineRisk = 0;
let treatmentCheckboxContainer;
let treatmentSummaryNote;
let treatmentSummaryBaseline;
let iconArrayContainer;
let iconArraySection;
let iconArrayTreatmentSelect;

function isChartLibraryAvailable() {
  return typeof window !== 'undefined' && typeof window.Chart === 'function';
}

function formatPercent(probability) {
  return `${(probability * 100).toFixed(1)}%`;
}

function collectFormData(form) {
  const formData = new FormData(form);
  return Object.fromEntries(formData.entries());
}

function calculateTreatmentRisks(baselineRisk) {
  return treatmentStrategies.map((strategy) => ({
    ...strategy,
    risk: clampProbability(baselineRisk * strategy.multiplier),
    absoluteBenefit: Math.max(0, baselineRisk - baselineRisk * strategy.multiplier),
  }));
}

function getSelectedTreatmentIds(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll("input[type='checkbox']:checked")).map(
    (input) => input.value,
  );
}

function buildTreatmentCheckboxes(container, onChange) {
  if (!container) return;
  container.innerHTML = '';

  treatmentStrategies.forEach((strategy) => {
    const option = document.createElement('div');
    option.className = 'checkbox-option';

    const checkboxId = `treatment-${strategy.id}`;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = checkboxId;
    checkbox.value = strategy.id;
    checkbox.checked = true;
    checkbox.addEventListener('change', onChange);

    const label = document.createElement('label');
    label.setAttribute('for', checkboxId);
    label.textContent = strategy.label;

    option.appendChild(checkbox);
    option.appendChild(label);
    container.appendChild(option);
  });
}

function updateTreatmentSummaryBaseline(baselineRisk) {
  if (!treatmentSummaryBaseline) return;
  if (Number.isFinite(baselineRisk)) {
    treatmentSummaryBaseline.textContent = `(baseline ${formatPercent(baselineRisk)})`;
  } else {
    treatmentSummaryBaseline.textContent = '';
  }
}

function updateTreatmentList(treatments, container, noteElement) {
  if (!container) return;

  container.innerHTML = '';

  const applicableTreatments = Array.isArray(treatments)
    ? treatments.filter((strategy) => strategy.id !== 'baseline')
    : [];

  if (!applicableTreatments.length) {
    if (noteElement) {
      noteElement.textContent = 'Calculate risk to view estimated benefits for each treatment strategy.';
    }

    const emptyState = document.createElement('li');
    emptyState.className = 'empty-state';
    emptyState.textContent = 'No treatment comparisons available yet.';
    container.appendChild(emptyState);
    return;
  }

  if (noteElement) {
    noteElement.textContent =
      'Estimated 10-year risk and absolute risk reduction compared with no pharmacotherapy.';
  }

  applicableTreatments.forEach((strategy) => {
    const listItem = document.createElement('li');

    const label = document.createElement('span');
    label.textContent = strategy.label;

    const value = document.createElement('span');
    const per1000 = Math.round(strategy.absoluteBenefit * 1000);
    value.innerHTML = `<strong>${formatPercent(strategy.risk)}</strong> (${per1000} per 1,000 avoid an event over 10 years)`;

    listItem.appendChild(label);
    listItem.appendChild(value);
    container.appendChild(listItem);
  });
}

function renderIconArray(container, baselineRisk, treatedRisk) {
  if (!container) return;
  container.innerHTML = '';

  const eventCount = Math.round(treatedRisk * 100);
  const avoidedCount = Math.max(0, Math.round(baselineRisk * 100) - eventCount);
  const safeCount = 100 - eventCount - avoidedCount;

  for (let i = 0; i < 100; i++) {
    const dot = document.createElement('div');
    dot.className = 'icon-dot';
    if (i < safeCount) {
      dot.classList.add('icon-dot--safe');
    } else if (i < safeCount + avoidedCount) {
      dot.classList.add('icon-dot--avoided');
    } else {
      dot.classList.add('icon-dot--event');
    }
    container.appendChild(dot);
  }
}

function populateIconArraySelect(selectEl, treatments) {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  const nonBaseline = treatments.filter((t) => t.id !== 'baseline');
  nonBaseline.forEach((t) => {
    const option = document.createElement('option');
    option.value = t.id;
    option.textContent = t.label;
    selectEl.appendChild(option);
  });
}

function updateIconArray() {
  if (!iconArrayContainer || !iconArrayTreatmentSelect || !latestTreatmentResults.length) return;
  const selectedId = iconArrayTreatmentSelect.value;
  const treatment = latestTreatmentResults.find((t) => t.id === selectedId);
  if (!treatment) return;

  iconArraySection.removeAttribute('hidden');
  renderIconArray(iconArrayContainer, latestBaselineRisk, treatment.risk);
}

const barValueLabelPlugin = {
  id: 'barValueLabel',
  afterDatasetsDraw(chart, args, pluginOptions) {
    const { ctx, data } = chart;
    const dataset = data.datasets?.[0];
    if (!dataset) return;

    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;

    const rootStyles = window.getComputedStyle(document.documentElement);
    const fallbackColour = pluginOptions?.color?.trim() || rootStyles.getPropertyValue('--text').trim() || '#1c2833';
    const fontOptions = pluginOptions?.font || {};
    const fontSize = fontOptions.size || 12;
    const fontFamily = fontOptions.family || "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif";
    const fontWeight = fontOptions.weight || '600';
    const yOffset = pluginOptions?.offset ?? 6;

    ctx.save();
    ctx.fillStyle = fallbackColour;
    ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';

    meta.data.forEach((element, index) => {
      const rawValue = dataset.data?.[index];
      if (!Number.isFinite(rawValue)) return;

      const position = element.tooltipPosition();
      ctx.fillText(`${Number(rawValue).toFixed(1)}%`, position.x, position.y - yOffset);
    });

    ctx.restore();
  },
};

function renderChart(canvas, treatments) {
  if (!canvas) return;

  if (!isChartLibraryAvailable()) {
    if (!chartUnavailableNotice) {
      const container = canvas.closest('.chart-container');
      const notice = document.createElement('p');
      notice.className = 'chart-unavailable';
      notice.textContent =
        'Chart preview is unavailable because the charting library could not be loaded.';

      if (container) {
        container.appendChild(notice);
        chartUnavailableNotice = notice;
      }
    }
    return;
  }

  if (chartUnavailableNotice) {
    chartUnavailableNotice.remove();
    chartUnavailableNotice = undefined;
  }

  const labels = treatments.map((t) => t.label);
  const data = treatments.map((t) => Number((t.risk * 100).toFixed(2)));
  const backgrounds = treatments.map(
    (_, index) => chartColours.background[index % chartColours.background.length],
  );
  const borders = treatments.map(
    (_, index) => chartColours.border[index % chartColours.border.length],
  );

  if (chartInstance) {
    chartInstance.data.labels = labels;
    chartInstance.data.datasets[0].data = data;
    chartInstance.data.datasets[0].backgroundColor = backgrounds;
    chartInstance.data.datasets[0].borderColor = borders;
    chartInstance.update();
    return;
  }

  const ChartConstructor = window.Chart;
  chartInstance = new ChartConstructor(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Estimated risk',
          data,
          backgroundColor: backgrounds,
          borderColor: borders,
          borderWidth: 1,
        },
      ],
    },
    plugins: [barValueLabelPlugin],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          max: 40,
          ticks: {
            callback: (value) => `${value}%`,
          },
          title: {
            display: true,
            text: '10-year risk (%)',
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            label(context) {
              const value = context.parsed.y;
              if (Number.isFinite(value)) {
                return `${value.toFixed(1)}%`;
              }
              return '0.0%';
            },
          },
        },
        barValueLabel: {
          offset: 10,
        },
      },
      animation: {
        duration: 400,
        easing: 'easeOutQuart',
      },
    },
  });
}

function updateFieldGroupVisibility(fields, shouldShow) {
  fields.forEach((field) => {
    if (shouldShow) {
      field.removeAttribute('hidden');
      field.removeAttribute('aria-hidden');
      if (typeof field.disabled === 'boolean') {
        field.disabled = false;
      }
    } else {
      field.setAttribute('hidden', 'hidden');
      field.setAttribute('aria-hidden', 'true');
      if (typeof field.disabled === 'boolean') {
        field.disabled = true;
      }
    }
  });
}

function toggleModelFields(selectedModel) {
  const riskCalculatorFields = document.querySelectorAll('.riskcalculator-only');
  const finriskFields = document.querySelectorAll('.finrisk-only');

  updateFieldGroupVisibility(riskCalculatorFields, selectedModel === 'riskcalculator');
  updateFieldGroupVisibility(finriskFields, selectedModel === 'finrisk');
}

function initializeForm() {
  const form = document.getElementById('risk-form');
  const modelSelect = document.getElementById('model');
  const baselineOutput = document.getElementById('baseline-risk');
  const treatmentList = document.getElementById('treatment-list');
  const chartCanvas = document.getElementById('risk-chart');
  treatmentCheckboxContainer = document.getElementById('treatment-checkboxes');
  treatmentSummaryNote = document.getElementById('treatment-summary-note');
  treatmentSummaryBaseline = document.getElementById('treatment-summary-baseline');
  iconArrayContainer = document.getElementById('icon-array');
  iconArraySection = document.getElementById('icon-array-section');
  iconArrayTreatmentSelect = document.getElementById('icon-array-treatment');

  if (iconArrayTreatmentSelect) {
    iconArrayTreatmentSelect.addEventListener('change', updateIconArray);
  }

  const yearElement = document.getElementById('year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }

  toggleModelFields(modelSelect.value);

  const applySelectedTreatmentsToChart = () => {
    if (!chartCanvas) return;
    const selectedIds = new Set(getSelectedTreatmentIds(treatmentCheckboxContainer));
    const filteredTreatments = latestTreatmentResults.filter((strategy) =>
      selectedIds.has(strategy.id),
    );
    renderChart(chartCanvas, filteredTreatments);
  };

  buildTreatmentCheckboxes(treatmentCheckboxContainer, applySelectedTreatmentsToChart);
  renderChart(chartCanvas, []);
  updateTreatmentSummaryBaseline();
  updateTreatmentList([], treatmentList, treatmentSummaryNote);

  modelSelect.addEventListener('change', (event) => {
    toggleModelFields(event.target.value);
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const inputs = collectFormData(form);
    const modelKey = inputs.model;
    const selectedModel = riskModels[modelKey];

    if (!selectedModel) {
      baselineOutput.innerHTML = '<strong>Unable to locate selected model.</strong>';
      return;
    }

    try {
      const baselineRisk = selectedModel.calculate(inputs);
      const formattedBaseline = formatPercent(baselineRisk);
      baselineOutput.innerHTML = `Baseline risk (${selectedModel.name}): <strong>${formattedBaseline}</strong>`;

      const treatments = calculateTreatmentRisks(baselineRisk);
      latestTreatmentResults = treatments;
      latestBaselineRisk = baselineRisk;
      updateTreatmentSummaryBaseline(baselineRisk);
      updateTreatmentList(treatments, treatmentList, treatmentSummaryNote);
      applySelectedTreatmentsToChart();
      populateIconArraySelect(iconArrayTreatmentSelect, treatments);
      updateIconArray();
    } catch (error) {
      console.error(error);
      baselineOutput.innerHTML =
        '<strong>Unable to calculate risk with the current inputs. Please review the form.</strong>';
      updateTreatmentSummaryBaseline();
      updateTreatmentList([], treatmentList, treatmentSummaryNote);
    }
  });
}

document.addEventListener('DOMContentLoaded', initializeForm);
