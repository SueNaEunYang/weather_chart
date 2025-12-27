import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// Configuration
const STATIONS = {
    '108': { name: 'Seoul', lat: 37.5665, lon: 126.9780 },
    '112': { name: 'Incheon', lat: 37.4563, lon: 126.7052 },
    '119': { name: 'Suwon', lat: 37.2636, lon: 127.0286 },
    '159': { name: 'Busan', lat: 35.1796, lon: 129.0756 }
};

const START_YEAR = 2020; // Start small for testing
const END_YEAR = 2024;   // Up to current year
const OUTPUT_DIR = '../data';

// Helper to resolve paths
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function fetchInternal(url) {
    console.log(`Fetching: ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
    return res.json();
}

async function ensureDir(dirPath) {
    try {
        await fs.mkdir(dirPath, { recursive: true });
    } catch (e) {
        if (e.code !== 'EEXIST') throw e;
    }
}

async function processStation(stationId, stationInfo) {
    console.log(`Processing Station: ${stationId} (${stationInfo.name})`);

    // Create station directory
    const stationDir = path.join(__dirname, OUTPUT_DIR, stationId);
    await ensureDir(stationDir);

    // 1. Generate Meta JSON
    const meta = {
        station_id: stationId,
        name_en: stationInfo.name,
        available_years: []
    };

    // 2. Loop Years
    for (let year = START_YEAR; year <= END_YEAR; year++) {
        const startDate = `${year}-01-01`;
        const endDate = `${year}-12-31`;

        // Open-Meteo API
        const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${stationInfo.lat}&longitude=${stationInfo.lon}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FSeoul`;

        try {
            const data = await fetchInternal(url);

            if (!data.daily || !data.daily.time) {
                console.error(`Invalid data for ${year}`);
                continue;
            }

            const { time, temperature_2m_min, temperature_2m_max } = data.daily;

            // Transform to array format: [Date, Min, Max]
            const days = [];
            for (let i = 0; i < time.length; i++) {
                // Skip if data is null (future dates or missing)
                if (temperature_2m_min[i] === null || temperature_2m_max[i] === null) continue;

                days.push([
                    time[i],
                    temperature_2m_min[i],
                    temperature_2m_max[i]
                ]);
            }

            if (days.length === 0) {
                console.warn(`No data found for ${year}`);
                continue;
            }

            // Save Year JSON
            const fileContent = {
                station: stationId,
                year: year,
                unit: "celsius",
                days: days
            };

            await fs.writeFile(
                path.join(stationDir, `${year}.json`),
                JSON.stringify(fileContent, null, 0) // Minified
            );

            meta.available_years.push(year);
            console.log(`  Saved ${year}.json (${days.length} days)`);

            // Polite delay to avoid rate limits
            await new Promise(r => setTimeout(r, 500));

        } catch (err) {
            console.error(`  Failed to process ${year}: ${err.message}`);
        }
    }

    // Save Meta JSON
    await fs.writeFile(
        path.join(stationDir, 'meta.json'),
        JSON.stringify(meta, null, 2)
    );
}

async function main() {
    for (const [id, info] of Object.entries(STATIONS)) {
        await processStation(id, info);
    }
    console.log("Data generation complete.");
}

main().catch(console.error);
