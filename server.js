const express = require("express");
const path = require("path");

const { runScan } = require("./src/scanner");

const app = express();

app.use(
    express.json({
        limit: "10mb"
    })
);

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);

/*
 * =========================================================
 * SCAN STORAGE
 * =========================================================
 */

const scans = new Map();

/*
 * =========================================================
 * HEALTH CHECK
 * =========================================================
 */

app.get("/api/health", (req, res) => {

    res.json({
        status: "OK",
        service: "Automated Broken Link Validator"
    });

});

/*
 * =========================================================
 * START SCAN
 *
 * Returns immediately.
 * Scanner runs in background.
 * =========================================================
 */

app.post("/api/scan/url", async (req, res) => {

    try {

        const {
            sitemapUrl
        } = req.body;

        if (!sitemapUrl) {

            return res.status(400).json({
                error: "Sitemap URL is required"
            });

        }

        /*
         * Validate URL
         */

        try {

            const parsedUrl =
                new URL(sitemapUrl);

            if (
                !["http:", "https:"]
                    .includes(parsedUrl.protocol)
            ) {

                return res.status(400).json({
                    error:
                        "Only HTTP and HTTPS sitemap URLs are supported"
                });

            }

        } catch {

            return res.status(400).json({
                error: "Invalid sitemap URL"
            });

        }

        /*
         * Create scan ID
         */

        const scanId =
            `scan-${Date.now()}-${Math.random()
                .toString(36)
                .substring(2, 8)}`;

        /*
         * Initial progress
         */

        const scan = {

            scanId,

            sitemapUrl,

            status: "running",

            startedAt:
                new Date().toISOString(),

            completedAt: null,

            result: null,

            error: null,

            progress: {

                phase: "starting",

                pagesFound: 0,

                pagesScanned: 0,

                linksDiscovered: 0,

                uniqueLinks: 0,

                linksValidated: 0,

                percent: 0

            }

        };

        scans.set(
            scanId,
            scan
        );

        console.log("");

        console.log(
            "========================================"
        );

        console.log(
            "NEW BACKGROUND SCAN"
        );

        console.log(
            "========================================"
        );

        console.log(
            "Scan ID:",
            scanId
        );

        console.log(
            "Sitemap:",
            sitemapUrl
        );

        console.log(
            "========================================"
        );

        /*
         * =================================================
         * RUN SCAN IN BACKGROUND
         * =================================================
         */

        setImmediate(async () => {

            try {

                console.log(
                    `Starting scanner: ${scanId}`
                );

                const result =
                    await runScan({

                        sitemapUrl,

                        onProgress: progress => {

                            /*
                             * Keep the scan object updated.
                             */

                            scan.progress = {
                                ...scan.progress,
                                ...progress
                            };

                        }

                    });

                /*
                 * Scan completed
                 */

                scan.status =
                    "completed";

                scan.completedAt =
                    new Date().toISOString();

                scan.result =
                    result;

                scan.progress = {

                    ...scan.progress,

                    phase: "completed",

                    pagesFound:
                        result.summary.pagesFound,

                    pagesScanned:
                        result.summary.pagesScanned,

                    linksDiscovered:
                        result.summary.linksDiscovered,

                    uniqueLinks:
                        result.summary.uniqueLinksChecked,

                    linksValidated:
                        result.summary.uniqueLinksChecked,

                    percent: 100

                };

                console.log(
                    `Scan completed: ${scanId}`
                );

            } catch (error) {

                console.error(
                    `Scan failed: ${scanId}`
                );

                console.error(error);

                scan.status =
                    "failed";

                scan.completedAt =
                    new Date().toISOString();

                scan.error =
                    error.message ||
                    "Scan failed";

                scan.progress = {

                    ...scan.progress,

                    phase: "failed"

                };

            }

        });

        /*
         * Return immediately
         */

        return res
            .status(202)
            .json({

                scanId,

                status: "running",

                message:
                    "Scan started successfully."

            });

    } catch (error) {

        console.error(
            "START SCAN ERROR:",
            error
        );

        return res
            .status(500)
            .json({

                error:
                    error.message ||
                    "Unable to start scan"

            });

    }

});

/*
 * =========================================================
 * GET SCAN STATUS / PROGRESS
 * =========================================================
 */

app.get(
    "/api/scan/:scanId",
    (req, res) => {

        const scan =
            scans.get(
                req.params.scanId
            );

        if (!scan) {

            return res
                .status(404)
                .json({

                    error:
                        "Scan not found"

                });

        }

        /*
         * RUNNING
         */

        if (
            scan.status ===
            "running"
        ) {

            return res.json({

                scanId:
                    scan.scanId,

                status:
                    "running",

                sitemapUrl:
                    scan.sitemapUrl,

                startedAt:
                    scan.startedAt,

                progress:
                    scan.progress

            });

        }

        /*
         * FAILED
         */

        if (
            scan.status ===
            "failed"
        ) {

            return res
                .status(500)
                .json({

                    scanId:
                        scan.scanId,

                    status:
                        "failed",

                    error:
                        scan.error,

                    progress:
                        scan.progress

                });

        }

        /*
         * COMPLETED
         */

        return res.json({

            scanId:
                scan.scanId,

            status:
                "completed",

            sitemapUrl:
                scan.sitemapUrl,

            startedAt:
                scan.startedAt,

            completedAt:
                scan.completedAt,

            progress:
                scan.progress,

            summary:
                scan.result.summary,

            pageErrors:
                scan.result.pageErrors,

            results:
                scan.result.results

        });

    }
);

/*
 * =========================================================
 * CSV DOWNLOAD
 * =========================================================
 */

app.get(
    "/api/scan/:scanId/csv",
    (req, res) => {

        const scan =
            scans.get(
                req.params.scanId
            );

        if (!scan) {

            return res
                .status(404)
                .json({

                    error:
                        "Scan not found"

                });

        }

        if (
            scan.status !==
            "completed"
        ) {

            return res
                .status(409)
                .json({

                    error:
                        "Scan is not completed yet"

                });

        }

        const results =
            scan.result.results ||
            [];

        const headers = [

            "Source Page",
            "Anchor Text",
            "Target URL",
            "Link Type",
            "Status",
            "HTTP Status",
            "Validation Method",
            "Final URL",
            "Response Time (ms)",
            "Error Message"

        ];

        const escapeCSV =
            value =>
                `"${String(
                    value ?? ""
                ).replace(
                    /"/g,
                    '""'
                )}"`;

        const rows =
            results.map(
                row => [

                    row.sourcePage,

                    row.anchorText,

                    row.targetUrl,

                    row.linkType,

                    row.validationStatus,

                    row.statusCode,

                    row.validationMethod,

                    row.finalUrl,

                    row.responseTimeMs,

                    row.errorMessage

                ]
            );

        const csv = [

            headers,

            ...rows

        ]
            .map(
                row =>
                    row
                        .map(
                            escapeCSV
                        )
                        .join(",")
            )
            .join("\n");

        res.setHeader(
            "Content-Type",
            "text/csv;charset=utf-8"
        );

        res.setHeader(
            "Content-Disposition",
            `attachment; filename="broken-link-report-${scan.scanId}.csv"`
        );

        return res.send(csv);

    }
);

/*
 * =========================================================
 * ROOT
 * =========================================================
 */

app.get("/", (req, res) => {

    res.sendFile(
        path.join(
            __dirname,
            "public",
            "index.html"
        )
    );

});

/*
 * =========================================================
 * SERVER
 * =========================================================
 */

const PORT =
    process.env.PORT || 3000;

app.listen(
    PORT,
    () => {

        console.log("");

        console.log(
            "========================================"
        );

        console.log(
            `Broken Link Validator running on port ${PORT}`
        );

        console.log(
            "Playwright scanner enabled"
        );

        console.log(
            "Background scan mode enabled"
        );

        console.log(
            "Real-time progress enabled"
        );

        console.log(
            "No maximum page limit"
        );

        console.log(
            "========================================"
        );

    }
);