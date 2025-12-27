# Configuration
$Stations = @{
    "108" = @{ name="Seoul"; lat=37.5665; lon=126.9780 };
    "112" = @{ name="Incheon"; lat=37.4563; lon=126.7052 };
    "119" = @{ name="Suwon"; lat=37.2636; lon=127.0286 };
    "159" = @{ name="Busan"; lat=35.1796; lon=129.0756 }
}

$StartYear = 2020
$EndYear = 2024
$OutputDir = "../data"

# Helper function to ensure directory exists
function Ensure-Directory($Path) {
    if (!(Test-Path -Path $Path)) {
        New-Item -ItemType Directory -Path $Path -Force | Out-Null
    }
}

# Main Loop
foreach ($StationId in $Stations.Keys) {
    $Info = $Stations[$StationId]
    Write-Host "Processing Station: $StationId ($($Info.name))"
    
    $BaseDir = Join-Path $PSScriptRoot $OutputDir
    $StationDir = Join-Path $BaseDir $StationId
    Ensure-Directory $StationDir
    
    $AvailableYears = @()
    
    for ($Year = $StartYear; $Year -le $EndYear; $Year++) {
        $StartDate = "$Year-01-01"
        $EndDate = "$Year-12-31"
        
        $Url = "https://archive-api.open-meteo.com/v1/archive?latitude=$($Info.lat)&longitude=$($Info.lon)&start_date=$StartDate&end_date=$EndDate&daily=temperature_2m_max,temperature_2m_min&timezone=Asia%2FSeoul"
        
        try {
            $Response = Invoke-RestMethod -Uri $Url -Method Get
            
            if ($null -eq $Response.daily -or $null -eq $Response.daily.time) {
                Write-Warning "Invalid data for $Year"
                continue
            }
            
            $Days = @()
            $Times = $Response.daily.time
            $Mins = $Response.daily.temperature_2m_min
            $Maxs = $Response.daily.temperature_2m_max
            
            for ($i = 0; $i -lt $Times.Count; $i++) {
                if ($null -eq $Mins[$i] -or $null -eq $Maxs[$i]) { continue }
                
                $Days += ,@($Times[$i], $Mins[$i], $Maxs[$i])
            }
            
            if ($Days.Count -eq 0) {
                Write-Warning "No valid data for $Year"
                continue
            }
            
            $JsonData = @{
                station = $StationId
                year = $Year
                unit = "celsius"
                days = $Days
            }
            
            $JsonContent = $JsonData | ConvertTo-Json -Depth 3 -Compress
            $FilePath = Join-Path $StationDir "$Year.json"
            $JsonContent | Set-Content -Path $FilePath -Encoding UTF8
            
            $AvailableYears += $Year
            Write-Host "  Saved $Year.json"
            
            Start-Sleep -Milliseconds 500
            
        } catch {
            Write-Error "Failed to process $Year : $_"
        }
    }
    
    # Save Meta
    $Meta = @{
        station_id = $StationId
        name_en = $Info.name
        available_years = $AvailableYears
    }
    
    $MetaPath = Join-Path $StationDir "meta.json"
    $Meta | ConvertTo-Json -Depth 2 | Set-Content -Path $MetaPath -Encoding UTF8
}

Write-Host "Data generation complete."
