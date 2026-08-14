let currentScanId = null;
let currentResults = [];
let currentSummary = null;
let progressTimer = null;

/*
=========================================================
DOM ELEMENTS
=========================================================
*/

const sitemapInput =
    document.getElementById("sitemapUrl");

const startScanButton =
    document.getElementById("startScan");

const scanStatus =
    document.getElementById("scanStatus");

const dashboard =
    document.getElementById("dashboard");

const pagesFound =
    document.getElementById("pagesFound");

const pagesScanned =
    document.getElementById("pagesScanned");

const linksDiscovered =
    document.getElementById("linksDiscovered");

const uniqueLinks =
    document.getElementById("uniqueLinks");

const validLinks =
    document.getElementById("validLinks");

const redirectLinks =
    document.getElementById("redirectLinks");

const brokenLinks =
    document.getElementById("brokenLinks");

const errorLinks =
    document.getElementById("errorLinks");

const resultsTable =
    document.getElementById("resultsTable");

const statusFilter =
    document.getElementById("statusFilter");


/*
=========================================================
HELPER
=========================================================
*/

function escapeHtml(value) {

    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/*
=========================================================
STATUS LABEL
=========================================================
*/

function getStatusLabel(status) {

    switch (status) {

        case "valid":
            return "Valid";

        case "redirect":
            return "Redirect";

        case "broken":
            return "Broken";

        case "access_restricted":
            return "Access Restricted";

        case "server_error":
            return "Server Error";

        case "unable_to_validate":
            return "Unable to Validate";

        default:
            return status || "Unknown";
    }
}


/*
=========================================================
STATUS CSS CLASS
=========================================================
*/

function getStatusClass(status) {

    switch (status) {

        case "valid":
            return "status-valid";

        case "redirect":
            return "status-redirect";

        case "broken":
            return "status-broken";

        case "access_restricted":
            return "status-error";

        case "server_error":
            return "status-error";

        case "unable_to_validate":
            return "status-error";

        default:
            return "status-error";
    }
}


/*
=========================================================
UPDATE DASHBOARD
=========================================================
*/

function updateDashboard(summary) {

    if (!summary) {
        return;
    }

    currentSummary = summary;

    pagesFound.textContent =
        summary.pagesFound ?? 0;

    pagesScanned.textContent =
        summary.pagesScanned ?? 0;

    linksDiscovered.textContent =
        summary.linksDiscovered ?? 0;

    uniqueLinks.textContent =
        summary.uniqueLinksChecked ?? 0;

    validLinks.textContent =
        summary.valid ?? 0;

    redirectLinks.textContent =
        summary.redirects ?? 0;

    brokenLinks.textContent =
        summary.broken ?? 0;

    /*
     * Errors include:
     *
     * Access Restricted
     * Server Errors
     * Unable To Validate
     */

    const totalErrors =
        (summary.accessRestricted ?? 0) +
        (summary.serverErrors ?? 0) +
        (summary.unableToValidate ?? 0);

    errorLinks.textContent =
        totalErrors;
}


/*
=========================================================
PROGRESS
=========================================================
*/

function updateProgress(progress) {

    if (!progress) {
        return;
    }

    const percent =
        Number(progress.percent ?? 0);

    const pages =
        progress.pagesScanned ?? 0;

    const totalPages =
        progress.pagesFound ?? 0;

    const discovered =
        progress.linksDiscovered ?? 0;

    const unique =
        progress.uniqueLinks ?? 0;

    const validated =
        progress.linksValidated ?? 0;

    let phaseText =
        "Scan in progress";

    if (
        progress.phase ===
        "loading_sitemap"
    ) {

        phaseText =
            "Loading sitemap";

    } else if (
        progress.phase ===
        "scanning_pages"
    ) {

        phaseText =
            "Scanning pages";

    } else if (
        progress.phase ===
        "validating_links"
    ) {

        phaseText =
            "Validating links";

    } else if (
        progress.phase ===
        "completed"
    ) {

        phaseText =
            "Scan completed";
    }

    scanStatus.innerHTML = `

        <div class="scan-progress">

            <div class="progress-header">

                <strong>
                    ${escapeHtml(phaseText)}
                </strong>

                <strong>
                    ${percent}%
                </strong>

            </div>

            <div class="progress-track">

                <div
                    class="progress-bar"
                    style="width:${percent}%"
                ></div>

            </div>

            <div class="progress-details">

                <span>
                    Pages:
                    ${pages}/${totalPages}
                </span>

                <span>
                    Links:
                    ${discovered}
                </span>

                <span>
                    Validated:
                    ${validated}/${unique}
                </span>

            </div>

        </div>

    `;
}


/*
=========================================================
START SCAN
=========================================================
*/

async function startScan() {

    /*
     * Prevent duplicate scans.
     */

    if (progressTimer) {
        return;
    }

    const sitemapUrl =
        sitemapInput.value.trim();

    if (!sitemapUrl) {

        scanStatus.innerHTML = `
            <div class="scan-error">
                Please enter a sitemap URL.
            </div>
        `;

        return;
    }


    /*
     * Validate sitemap URL.
     */

    try {

        const parsed =
            new URL(sitemapUrl);

        if (
            !["http:", "https:"]
                .includes(parsed.protocol)
        ) {

            throw new Error(
                "Only HTTP and HTTPS URLs are supported."
            );
        }

    } catch {

        scanStatus.innerHTML = `
            <div class="scan-error">
                Please enter a valid sitemap URL.
            </div>
        `;

        return;
    }


    /*
     * Reset previous scan.
     */

    currentScanId = null;
    currentResults = [];
    currentSummary = null;

    /*
     * IMPORTANT:
     *
     * Keep dashboard hidden until
     * scan is completely finished.
     */

    dashboard.classList.add("hidden");

    resultsTable.innerHTML = "";

    statusFilter.value = "all";


    /*
     * Show progress.
     */

    updateProgress({

        phase: "starting",

        pagesFound: 0,

        pagesScanned: 0,

        linksDiscovered: 0,

        uniqueLinks: 0,

        linksValidated: 0,

        percent: 0
    });


    /*
     * Disable Start Scan.
     */

    startScanButton.disabled = true;

    startScanButton.textContent =
        "Scanning...";


    try {

        /*
         * Start server scan.
         */

        const response =
            await fetch(
                "/api/scan/url",
                {

                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify({
                            sitemapUrl
                        })
                }
            );


        /*
         * HTTP error.
         */

        if (!response.ok) {

            let errorMessage =
                `HTTP ${response.status}`;

            try {

                const errorData =
                    await response.json();

                if (
                    errorData &&
                    errorData.error
                ) {

                    errorMessage =
                        errorData.error;
                }

            } catch {
                // Ignore non-JSON response.
            }

            throw new Error(
                errorMessage
            );
        }


        const data =
            await response.json();


        if (!data.scanId) {

            throw new Error(
                "Server did not return a scan ID."
            );
        }


        currentScanId =
            data.scanId;


        /*
         * Begin polling.
         */

        pollScanStatus();

    } catch (error) {

        console.error(
            "Start scan error:",
            error
        );

        scanStatus.innerHTML = `
            <div class="scan-error">
                Scan failed:
                ${escapeHtml(
                    error.message
                )}
            </div>
        `;

        startScanButton.disabled =
            false;

        startScanButton.textContent =
            "Start Scan";

        progressTimer = null;
    }
}


/*
=========================================================
POLL SCAN STATUS
=========================================================
*/

function pollScanStatus() {

    if (progressTimer) {

        clearTimeout(
            progressTimer
        );
    }

    checkScanStatus();
}


/*
=========================================================
CHECK SCAN STATUS
=========================================================
*/

async function checkScanStatus() {

    if (!currentScanId) {
        return;
    }


    try {

        const response =
            await fetch(
                `/api/scan/${encodeURIComponent(
                    currentScanId
                )}`,
                {
                    method: "GET",
                    cache: "no-store"
                }
            );


        /*
         * Failed scan uses HTTP 500
         * from server.js.
         */

        if (
            !response.ok &&
            response.status !== 500
        ) {

            throw new Error(
                `HTTP ${response.status}`
            );
        }


        const data =
            await response.json();


        /*
         * Update progress.
         */

        if (data.progress) {

            updateProgress(
                data.progress
            );
        }


        /*
         * RUNNING
         */

        if (
            data.status ===
            "running"
        ) {

            progressTimer =
                setTimeout(
                    checkScanStatus,
                    1000
                );

            return;
        }


        /*
         * FAILED
         */

        if (
            data.status ===
            "failed"
        ) {

            scanStatus.innerHTML = `
                <div class="scan-error">
                    Scan failed:
                    ${escapeHtml(
                        data.error ||
                        "Unknown scanner error"
                    )}
                </div>
            `;

            startScanButton.disabled =
                false;

            startScanButton.textContent =
                "Start Scan";

            progressTimer = null;

            return;
        }


        /*
         * COMPLETED
         */

        if (
            data.status ===
            "completed"
        ) {

            /*
             * Force progress to 100%.
             */

            updateProgress({

                ...(data.progress || {}),

                phase:
                    "completed",

                percent:
                    100
            });


            /*
             * Store results.
             */

            currentResults =
                Array.isArray(
                    data.results
                )
                    ? data.results
                    : [];


            currentSummary =
                data.summary || {};


            /*
             * Update dashboard
             * with FINAL values.
             */

            updateDashboard(
                currentSummary
            );


            /*
             * IMPORTANT:
             *
             * Dashboard is shown ONLY
             * after scan completion.
             */

            dashboard.classList.remove(
                "hidden"
            );


            /*
             * Render results.
             */

            renderResults();


            /*
             * Enable Start Scan again.
             */

            startScanButton.disabled =
                false;

            startScanButton.textContent =
                "Start Scan";

            progressTimer = null;

            return;
        }


        /*
         * Unexpected status.
         */

        throw new Error(
            `Unknown scan status: ${data.status}`
        );

    } catch (error) {

        console.error(
            "Scan status error:",
            error
        );

        scanStatus.innerHTML = `
            <div class="scan-error">
                Unable to get scan status:
                ${escapeHtml(
                    error.message
                )}
            </div>
        `;

        startScanButton.disabled =
            false;

        startScanButton.textContent =
            "Start Scan";

        progressTimer = null;
    }
}


/*
=========================================================
FILTER RESULTS
=========================================================
*/

function getFilteredResults() {

    const filter =
        statusFilter.value;


    if (
        filter ===
        "all"
    ) {

        return currentResults;
    }


    /*
     * Error filter includes:
     *
     * access_restricted
     * server_error
     * unable_to_validate
     */

    if (
        filter ===
        "error"
    ) {

        return currentResults.filter(
            result =>

                result.validationStatus ===
                    "access_restricted" ||

                result.validationStatus ===
                    "server_error" ||

                result.validationStatus ===
                    "unable_to_validate"
        );
    }


    return currentResults.filter(
        result =>
            result.validationStatus ===
            filter
    );
}


/*
=========================================================
RENDER RESULTS
=========================================================
*/

function renderResults() {

    const results =
        getFilteredResults();


    if (!results.length) {

        resultsTable.innerHTML = `

            <tr>

                <td
                    colspan="6"
                    style="
                        text-align:center;
                        padding:30px;
                    "
                >
                    No results found.
                </td>

            </tr>
        `;

        return;
    }


    resultsTable.innerHTML =
        results
            .map(
                result => {

                    const status =
                        result.validationStatus;

                    const statusLabel =
                        getStatusLabel(
                            status
                        );

                    const statusClass =
                        getStatusClass(
                            status
                        );


                    const response =
                        result.statusCode
                            ? result.statusCode
                            : "-";


                    const anchorText =
                        result.anchorText ||
                        "(No anchor text)";


                    const targetUrl =
                        result.targetUrl ||
                        "";


                    /*
                     * For undefined links,
                     * don't create a clickable
                     * href="undefined".
                     */

                    const targetCell =
                        targetUrl === "undefined"
                            ? `
                                <span>
                                    ${escapeHtml(
                                        targetUrl
                                    )}
                                </span>
                            `
                            : `
                                <a
                                    href="${escapeHtml(
                                        targetUrl
                                    )}"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    ${escapeHtml(
                                        targetUrl
                                    )}
                                </a>
                            `;


                    return `

                        <tr>

                            <td>
                                ${escapeHtml(
                                    result.sourcePage
                                )}
                            </td>

                            <td>
                                ${escapeHtml(
                                    anchorText
                                )}
                            </td>

                            <td>
                                ${targetCell}
                            </td>

                            <td>
                                ${escapeHtml(
                                    result.linkType
                                )}
                            </td>

                            <td>

                                <span
                                    class="status-badge ${statusClass}"
                                >
                                    ${escapeHtml(
                                        statusLabel
                                    )}
                                </span>

                            </td>

                            <td>
                                ${escapeHtml(
                                    response
                                )}
                            </td>

                        </tr>
                    `;
                }
            )
            .join("");
}


/*
=========================================================
FILTER EVENT
=========================================================
*/

if (statusFilter) {

    statusFilter.addEventListener(
        "change",
        () => {

            renderResults();
        }
    );
}


/*
=========================================================
CSV DOWNLOAD
=========================================================
*/

function downloadCSV() {

    if (!currentScanId) {

        alert(
            "Please complete a scan first."
        );

        return;
    }


    window.location.href =
        `/api/scan/${encodeURIComponent(
            currentScanId
        )}/csv`;
}


/*
=========================================================
INITIAL STATE
=========================================================
*/

document.addEventListener(
    "DOMContentLoaded",
    () => {

        if (dashboard) {

            dashboard.classList.add(
                "hidden"
            );
        }

    }
);


/*
=========================================================
MAKE FUNCTIONS AVAILABLE TO HTML
=========================================================
*/

window.startScan =
    startScan;

window.downloadCSV =
    downloadCSV;