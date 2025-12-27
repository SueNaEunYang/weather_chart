/**
 * Static Weather Visualization App
 * Principles:
 * 1. No API calls to external services.
 * 2. Fetch JSON from /public/data/{stationId}/{year}.json.
 * 3. Render using Canvas (No heavy libraries).
 */

/**
 * Static Weather Visualization App
 */

// --- Constants ---
const DATA_BASE_URL = './data';
const MAX_CACHE_SIZE = 3;

// --- Data Manager ---
class DataManager {
    constructor() {
        // Cache: Map<StationId, Map<Year, Data>>
        // But simpler: just Map<Key, Data> where Key = `${stationId}-${year}`
        this.cache = new Map();
        this.accessHistory = []; // To track LRU
    }

    getKey(stationId, year) {
        return `${stationId}-${year}`;
    }

    async fetchMeta(stationId) {
        try {
            const res = await fetch(`${DATA_BASE_URL}/${stationId}/meta.json`);
            if (!res.ok) throw new Error('Meta not found');
            return await res.json();
        } catch (e) {
            console.warn("Fetch failed:", e);
            // Fallback for local file:// usage
            if (window.location.protocol === 'file:') {
                console.info("Running in local file mode. Using Mock Data.");
                return this.getMockMeta(stationId);
            }
            return null;
        }
    }

    async fetchData(stationId, year) {
        const key = this.getKey(stationId, year);

        if (this.cache.has(key)) {
            this.updateAccess(key);
            console.log(`Cache hit for ${key}`);
            return this.cache.get(key);
        }

        console.log(`Fetching ${key}...`);
        try {
            const res = await fetch(`${DATA_BASE_URL}/${stationId}/${year}.json`);
            if (!res.ok) throw new Error(`Data for ${year} not found`);
            const data = await res.json();

            this.addToCache(key, data);
            return data;
        } catch (e) {
            if (window.location.protocol === 'file:') {
                return this.getMockData(stationId, year);
            }
            throw e;
        }
    }

    // --- Mock Data for Local Testing ---
    getMockMeta(stationId) {
        // Simple mock returning 2020-2024
        return {
            station_id: stationId,
            name_en: "Local Test",
            available_years: [2020, 2021, 2022, 2023, 2024, 2025]
        };
    }

    getMockData(stationId, year) {
        console.info(`Generating mock data for ${year}`);
        // Generate pseudo-random realistic looking data
        const days = [];
        const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
        const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

        // Base temp curve for Korea (Cold winter, Hot summer)
        // Jan: -5, Aug: 30
        let currentYear = year;

        let dayCount = 0;
        for (let m = 0; m < 12; m++) {
            for (let d = 1; d <= daysInMonth[m]; d++) {
                // Approximate seasonality
                // Day of year 0-365
                dayCount++;
                const angle = ((dayCount - 15) / 365) * 2 * Math.PI; // Shifted so coldest is mid-Jan
                const baseTemp = 12.5 - 15 * Math.cos(angle);

                // Random variation
                const dailyVar = (Math.random() - 0.5) * 10;
                const min = parseFloat((baseTemp + dailyVar - 5).toFixed(1));
                const max = parseFloat((baseTemp + dailyVar + 5).toFixed(1));

                const monthStr = String(m + 1).padStart(2, '0');
                const dayStr = String(d).padStart(2, '0');

                days.push([`${currentYear}-${monthStr}-${dayStr}`, min, max]);
            }
        }

        return {
            station: stationId,
            year: year,
            unit: "celsius",
            days: days
        };
    }

    addToCache(key, data) {
        this.cache.set(key, data);
        this.updateAccess(key);

        if (this.cache.size > MAX_CACHE_SIZE) {
            const oldestKey = this.accessHistory.shift();
            if (oldestKey && this.cache.has(oldestKey)) {
                this.cache.delete(oldestKey);
                console.log(`Evicted ${oldestKey} from cache`);
            }
        }
    }

    updateAccess(key) {
        // Remove existing
        this.accessHistory = this.accessHistory.filter(k => k !== key);
        // Add to end (most recently used)
        this.accessHistory.push(key);
    }
}

// --- Chart Renderer ---
class ChartRenderer {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.data = null;

        // View State
        this.startIndex = 0;
        this.visibleCount = 365; // Default full year
        this.minVisible = 14;    // Min 2 weeks

        // Interaction State
        this.isDragging = false;
        this.lastX = 0;

        this.initEvents();
    }

    initEvents() {
        this.resize();
        window.addEventListener('resize', () => {
            this.resize();
            this.draw();
        });

        // Mouse Events
        this.canvas.addEventListener('mousedown', (e) => this.startDrag(e.clientX));
        window.addEventListener('mousemove', (e) => this.drag(e.clientX));
        window.addEventListener('mouseup', () => this.endDrag());
        this.canvas.addEventListener('click', (e) => this.handleClick(e));

        // Touch Events
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) this.startDrag(e.touches[0].clientX);
        });
        window.addEventListener('touchmove', (e) => {
            if (e.touches.length === 1) this.drag(e.touches[0].clientX);
        });
        window.addEventListener('touchend', () => this.endDrag());

        // Wheel Zoom
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const direction = e.deltaY > 0 ? 1 : -1;
            this.zoom(direction * 0.1); // 10% zoom
        }, { passive: false });
    }

    resize() {
        const container = this.canvas.parentElement;
        this.canvas.width = container.clientWidth;
        this.canvas.height = container.clientHeight;
    }

    setData(data) {
        this.data = data; // { days: [[date, min, max], ...], unit }
        if (data && data.days) {
            this.startIndex = 0;
            this.visibleCount = data.days.length;
        }
        this.draw();
    }

    // --- Interaction Methods ---

    startDrag(x) {
        this.isDragging = true;
        this.lastX = x;
        this.canvas.style.cursor = 'grabbing';
    }

    drag(x) {
        if (!this.isDragging || !this.scaleInfo) return;

        const dx = x - this.lastX;
        this.lastX = x;

        // Pan Calculation
        // dx pixels corresponds to how many bars?
        const barsMoved = dx / this.scaleInfo.barWidth;

        this.startIndex -= barsMoved;
        this.clampWindow();
        this.draw();
    }

    endDrag() {
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
    }

    zoom(amount) {
        console.log(`Zooming by ${amount}. Current Visible: ${this.visibleCount}`);
        // Amount: +ve zoom out (show more), -ve zoom in (show less)
        // Wait, typical UI: + to Zoom In (show less), - to Zoom Out (show more)
        // Let's standardize: pass POSITIVE to zoom IN (reduce count), NEGATIVE to zoom OUT

        if (!this.data) return;

        const total = this.data.days.length;
        const newCount = this.visibleCount * (1 - amount);

        const centerRatio = 0.5; // Zoom to center
        const currentCenter = this.startIndex + (this.visibleCount * centerRatio);

        this.visibleCount = Math.max(this.minVisible, Math.min(total, newCount));

        // Adjust start to keep center
        this.startIndex = currentCenter - (this.visibleCount * centerRatio);
        this.clampWindow();
        this.draw();
    }

    resetZoom() {
        if (!this.data) return;
        this.startIndex = 0;
        this.visibleCount = this.data.days.length;
        this.draw();
    }

    clampWindow() {
        if (!this.data) return;
        const total = this.data.days.length;

        if (this.visibleCount > total) this.visibleCount = total;
        if (this.startIndex < 0) this.startIndex = 0;
        if (this.startIndex + this.visibleCount > total) {
            this.startIndex = total - this.visibleCount;
        }
    }

    // --- Drawing ---

    draw() {
        if (!this.data || !this.data.days) return;

        const ctx = this.ctx;
        const width = this.canvas.width;
        const height = this.canvas.height;
        const days = this.data.days;

        // Determine View Window
        const start = Math.floor(this.startIndex);
        const count = Math.ceil(this.visibleCount);
        const end = Math.min(days.length, start + count);

        const viewData = days.slice(start, end);
        if (viewData.length === 0) return;

        // Configuration
        const padding = { top: 40, right: 50, bottom: 40, left: 50 };
        const chartWidth = width - padding.left - padding.right;
        const chartHeight = height - padding.top - padding.bottom;

        // Clear
        ctx.clearRect(0, 0, width, height);

        // 1. Calculate Scale (Global Y for stability, or Local Y for detail?)
        // Let's use Global Y for the current year so bars don't jump up and down wildly while panning
        // BUT, user asked to "Zoom", typically implies seeing details.
        // Let's update Scale primarily based on VIEW data for max detail?
        // No, keep year-context is usually better for weather. 
        // Let's stick to Year Min/Max for Y-axis stability.

        let minTemp = 100;
        let maxTemp = -100;

        // Calculate min/max from WHOLE year to keep Y axis stable
        days.forEach(d => {
            if (d[1] < minTemp) minTemp = d[1];
            if (d[2] > maxTemp) maxTemp = d[2];
        });

        const rangePadding = (maxTemp - minTemp) * 0.1;
        minTemp = Math.floor(minTemp - rangePadding);
        maxTemp = Math.ceil(maxTemp + rangePadding);
        const rangeY = maxTemp - minTemp;

        const getY = (temp) => {
            return padding.top + chartHeight - ((temp - minTemp) / rangeY * chartHeight);
        };

        // 2. Draw Grid & Y-Axis
        ctx.fillStyle = '#666';
        ctx.strokeStyle = '#eee';
        ctx.lineWidth = 1;
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        for (let i = 0; i <= 5; i++) {
            const temp = minTemp + (rangeY * (i / 5));
            const y = getY(temp);
            ctx.beginPath();
            ctx.moveTo(padding.left, y);
            ctx.lineTo(width - padding.right, y);
            ctx.stroke();
            ctx.fillText(`${Math.round(temp)}°C`, width - padding.right + 5, y);
        }

        // 3. X-Axis (Dates)
        // Dynamically adjust label frequency based on zoom
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const barWidth = chartWidth / viewData.length;

        const labelStep = Math.ceil(viewData.length / 6); // Aim for ~6 labels

        viewData.forEach((day, i) => {
            if (i % labelStep === 0) {
                const x = padding.left + (i * barWidth) + (barWidth / 2);
                const dateParts = day[0].split('-'); // YYYY-MM-DD
                const label = `${dateParts[1]}.${dateParts[2]}`; // MM.DD

                ctx.fillText(label, x, height - padding.bottom + 10);
            }
        });

        // 4. Draw Candles
        // If many bars, thinner. If zoomed in, thicker.
        const gap = Math.max(1, barWidth * 0.2);
        const candleWidth = Math.max(1, barWidth - gap);

        let prevMid = 0;

        viewData.forEach((day, i) => {
            const [dateStr, tMin, tMax] = day;
            const tMid = (tMin + tMax) / 2;

            const cx = padding.left + (i * barWidth) + (barWidth / 2);

            const yMin = getY(tMin);
            const yMax = getY(tMax);

            // Color
            let color = '#d63384';
            if (i > 0 || start > 0) {
                // We need previous day data from the original array for accurate trend color at edges
                // Simple approx: use visible prevMid logic
                if (tMid < prevMid) color = '#1f78b4';
                else color = '#e31a1c';
            }
            prevMid = tMid;

            // Wick
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.min(2, candleWidth / 3);
            ctx.beginPath();
            ctx.moveTo(cx, yMin);
            ctx.lineTo(cx, yMax);
            ctx.stroke();

            // Body (Range) - Actually our style IS a wick-only candle (Line). 
            // Let's make it a bit thicker if zoomed in
            if (candleWidth > 4) {
                ctx.lineWidth = candleWidth;
                ctx.beginPath();
                ctx.moveTo(cx, yMin);
                ctx.lineTo(cx, yMax);
                ctx.stroke();
            }
        });

        this.scaleInfo = { padding, barWidth, viewData, start };
    }

    handleClick(e) {
        if (this.isDragging) return; // Ignore click after drag
        if (!this.scaleInfo) return;

        const rect = this.canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;

        if (mouseX < this.scaleInfo.padding.left) return;

        const i = Math.floor((mouseX - this.scaleInfo.padding.left) / this.scaleInfo.barWidth);
        const dayData = this.scaleInfo.viewData[i];

        if (dayData) {
            this.showTooltip(e.clientX, e.clientY, dayData);
        }
    }

    showTooltip(x, y, data) {
        const tooltip = document.getElementById('tooltip');
        tooltip.innerHTML = `
            <strong>${data[0]}</strong><br>
            Low: ${data[1]}°C<br>
            High: ${data[2]}°C
        `;
        // Keep inside window
        const winWidth = window.innerWidth;
        if (x + 150 > winWidth) x = x - 150;

        tooltip.style.left = `${x + 15}px`;
        tooltip.style.top = `${y}px`;
        tooltip.classList.remove('hidden');

        // Current spec says "Click to confirm", let's keep it simple.
        setTimeout(() => tooltip.classList.add('hidden'), 3000);
    }
}

// --- App Controller ---
class WeatherApp {
    constructor() {
        this.currentYear = 2025;
        this.stationId = '108'; // Default: Seoul

        this.dataManager = new DataManager();
        this.chart = new ChartRenderer('weather-chart');

        this.ui = {
            stationSelect: document.getElementById('station-select'),
            yearDisplay: document.getElementById('current-year-display'),
            btnPrev: document.querySelector('button[data-action="prev"]'),
            btnNext: document.querySelector('button[data-action="next"]'),
            loader: document.getElementById('loading-indicator'),
            error: document.getElementById('error-message')
        };

        this.init();
    }

    async init() {
        this.bindEvents();
        await this.loadStation(this.stationId);
    }

    bindEvents() {
        this.ui.stationSelect.addEventListener('change', (e) => {
            this.stationId = e.target.value;
            this.loadStation(this.stationId);
        });

        this.ui.btnPrev.addEventListener('click', () => this.changeYear(-1));
        this.ui.btnNext.addEventListener('click', () => this.changeYear(1));

        // Zoom Controls
        const btnZoomIn = document.getElementById('btn-zoom-in');
        const btnZoomOut = document.getElementById('btn-zoom-out');
        const btnReset = document.getElementById('btn-reset');

        if (btnZoomIn) {
            btnZoomIn.addEventListener('click', () => {
                console.log("Zoom In Clicked");
                this.chart.zoom(0.25);
            });
        }
        if (btnZoomOut) {
            btnZoomOut.addEventListener('click', () => {
                console.log("Zoom Out Clicked");
                this.chart.zoom(-0.25);
            });
        }
        if (btnReset) {
            btnReset.addEventListener('click', () => {
                console.log("Reset Clicked");
                this.chart.resetZoom();
            });
        }
    }

    async loadStation(id) {
        this.ui.stationSelect.disabled = true;
        try {
            // Load Meta
            const meta = await this.dataManager.fetchMeta(id);
            if (!meta) throw new Error("Station Meta not found");

            this.availableYears = meta.available_years.sort((a, b) => a - b);

            // If current year not in available, pick closest or last
            if (!this.availableYears.includes(this.currentYear)) {
                this.currentYear = this.availableYears[this.availableYears.length - 1];
            }

            await this.loadYear(this.currentYear);
        } catch (e) {
            this.showError(e.message);
        } finally {
            this.ui.stationSelect.disabled = false;
        }
    }

    async changeYear(offset) {
        if (!this.availableYears) return;

        const currentIndex = this.availableYears.indexOf(this.currentYear);
        let newIndex = currentIndex + offset;

        if (newIndex >= 0 && newIndex < this.availableYears.length) {
            this.currentYear = this.availableYears[newIndex];
            await this.loadYear(this.currentYear);
        }
    }

    async loadYear(year) {
        this.showLoading(true);
        this.updateYearUI();

        try {
            const data = await this.dataManager.fetchData(this.stationId, year);
            this.chart.setData(data);
            this.showError(null); // Clear errors
        } catch (e) {
            this.showError(`Failed to load data for ${year}`);
        } finally {
            this.showLoading(false);
        }
    }

    updateYearUI() {
        this.ui.yearDisplay.textContent = this.currentYear;
        // Disable buttons if at specific bounds? 
        // For now keep them enabled, changeYear checks bounds.
    }

    showLoading(isLoading) {
        if (isLoading) this.ui.loader.classList.remove('hidden');
        else this.ui.loader.classList.add('hidden');
    }

    showError(msg) {
        if (msg) {
            this.ui.error.textContent = msg;
            this.ui.error.classList.remove('hidden');
        } else {
            this.ui.error.classList.add('hidden');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    window.app = new WeatherApp();
});
