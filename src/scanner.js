const { chromium } = require("playwright");

const USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
    "AppleWebKit/537.36 (KHTML, like Gecko) " +
    "Chrome/151.0.0.0 Safari/537.36";

const PAGE_TIMEOUT = 30000;
const LINK_TIMEOUT = 25000;
const RENDER_WAIT = 1000;


/*
=========================================================
URL NORMALIZATION
=========================================================
*/

function normalizeUrl(href, sourceUrl) {

    try {

        const value =
            String(href ?? "").trim();


        if (!value) {
            return null;
        }


        /*
         * IMPORTANT:
         *
         * href="undefined" is NOT a valid URL.
         */

        if (
            value.toLowerCase() ===
            "undefined"
        ) {

            return null;
        }


        const url =
            new URL(
                value,
                sourceUrl
            );


        if (
            !["http:", "https:"]
                .includes(url.protocol)
        ) {

            return null;
        }


        url.hash = "";


        return url.toString();

    } catch {

        return null;
    }
}


/*
=========================================================
LINK TYPE
=========================================================
*/

function getLinkType(
    targetUrl,
    sourceUrl
) {

    try {

        const source =
            new URL(sourceUrl);

        const target =
            new URL(targetUrl);


        return (
            source.hostname.toLowerCase() ===
            target.hostname.toLowerCase()
        )
            ? "Internal"
            : "External";

    } catch {

        return "Unknown";
    }
}


/*
=========================================================
IGNORE NON HTTP LINKS
=========================================================
*/

function shouldIgnore(href) {

    const value =
        String(href ?? "")
            .trim()
            .toLowerCase();


    /*
     * IMPORTANT:
     *
     * Do NOT ignore undefined.
     */

    if (
        value ===
        "undefined"
    ) {

        return false;
    }


    return (

        !value ||

        value.startsWith("#") ||

        value.startsWith(
            "javascript:"
        ) ||

        value.startsWith(
            "mailto:"
        ) ||

        value.startsWith(
            "tel:"
        ) ||

        value.startsWith(
            "sms:"
        ) ||

        value.startsWith(
            "data:"
        ) ||

        value.startsWith(
            "blob:"
        )
    );
}


/*
=========================================================
LOAD SITEMAP
=========================================================
*/

async function loadSitemap(
    sitemapUrl,
    browser
) {

    try {

        console.log(
            `Loading sitemap using HTTP: ${sitemapUrl}`
        );


        const response =
            await fetch(
                sitemapUrl,
                {
                    headers: {

                        "User-Agent":
                            USER_AGENT,

                        "Accept":
                            "application/xml,text/xml,*/*"
                    },

                    redirect:
                        "follow"
                }
            );


        if (response.ok) {

            const xml =
                await response.text();


            if (
                xml &&
                xml.trim()
            ) {

                console.log(
                    "Sitemap loaded successfully using HTTP."
                );

                return xml;
            }
        }


        console.log(
            `HTTP sitemap request returned ${response.status}`
        );

    } catch (error) {

        console.log(
            "HTTP sitemap request failed."
        );

        console.log(
            error.message
        );
    }


    /*
     * Chromium fallback.
     */

    if (!browser) {

        throw new Error(
            "Unable to load sitemap."
        );
    }


    console.log(
        "Trying sitemap using Chromium fallback..."
    );


    const page =
        await browser.newPage({
            userAgent:
                USER_AGENT
        });


    try {

        page.setDefaultNavigationTimeout(
            PAGE_TIMEOUT
        );


        const response =
            await page.goto(
                sitemapUrl,
                {
                    waitUntil:
                        "domcontentloaded",

                    timeout:
                        PAGE_TIMEOUT
                }
            );


        const status =
            response?.status() || 0;


        const xml =
            await page.content();


        if (
            status >= 200 &&
            status < 400 &&
            xml &&
            xml.trim()
        ) {

            console.log(
                "Sitemap loaded successfully using Chromium."
            );

            return xml;
        }


        throw new Error(
            `Sitemap returned HTTP ${status}`
        );

    } finally {

        await page.close();
    }
}


/*
=========================================================
EXTRACT SITEMAP URLS
=========================================================
*/

function extractSitemapUrls(xml) {

    const matches = [
        ...xml.matchAll(
            /<loc>\s*([\s\S]*?)\s*<\/loc>/gi
        )
    ];


    return [
        ...new Set(
            matches
                .map(
                    match =>
                        match[1].trim()
                )
                .filter(Boolean)
        )
    ];
}


/*
=========================================================
EXTRACT ANCHORS
=========================================================
*/

async function extractAnchors(page) {

    return await page
        .locator("a")
        .evaluateAll(
            anchors => {

                return anchors.map(
                    anchor => {

                        /*
                         * IMPORTANT:
                         *
                         * getAttribute() returns
                         * exactly what exists in DOM.
                         *
                         * Therefore:
                         *
                         * <a href="undefined"></a>
                         *
                         * gives:
                         *
                         * "undefined"
                         */

                        const hrefAttribute =
                            anchor.getAttribute(
                                "href"
                            );


                        const anchorText =
                            (
                                anchor.innerText ||
                                anchor.textContent ||
                                ""
                            )
                                .replace(
                                    /\s+/g,
                                    " "
                                )
                                .trim();


                        return {

                            rawHref:
                                hrefAttribute === null
                                    ? ""
                                    : String(
                                        hrefAttribute
                                    ).trim(),


                            isUndefinedHref:
                                hrefAttribute !== null &&
                                String(
                                    hrefAttribute
                                )
                                    .trim()
                                    .toLowerCase() ===
                                    "undefined",


                            anchorText
                        };
                    }
                );
            }
        );
}


/*
=========================================================
ANCHOR SNAPSHOT
=========================================================

The previous implementation waited only for a fixed
render delay. That can miss dynamically populated hrefs.

This snapshot captures the actual anchor state:
- href
- anchor text

The scan waits until that state is stable across
multiple checks.
=========================================================
*/

async function getAnchorSnapshot(page) {

    try {

        return await page
            .locator("a")
            .evaluateAll(
                anchors => {

                    return anchors.map(
                        anchor => ({

                            href:
                                anchor.getAttribute(
                                    "href"
                                ),

                            text:
                                (
                                    anchor.innerText ||
                                    anchor.textContent ||
                                    ""
                                )
                                    .replace(
                                        /\s+/g,
                                        " "
                                    )
                                    .trim()

                        })
                    );

                }
            );

    } catch {

        return [];
    }
}


/*
=========================================================
WAIT FOR DYNAMIC ANCHORS TO SETTLE
=========================================================
*/

async function waitForAnchorsToSettle(page) {

    const MAX_WAIT =
        7000;

    const CHECK_INTERVAL =
        400;

    const REQUIRED_STABLE_CHECKS =
        3;


    const started =
        Date.now();


    let previousSnapshot =
        null;


    let stableChecks =
        0;


    while (
        Date.now() - started <
        MAX_WAIT
    ) {

        const currentSnapshot =
            await getAnchorSnapshot(
                page
            );


        const currentSerialized =
            JSON.stringify(
                currentSnapshot
            );


        if (
            currentSerialized ===
            previousSnapshot
        ) {

            stableChecks++;

        } else {

            stableChecks =
                0;
        }


        previousSnapshot =
            currentSerialized;


        /*
         * Anchor collection and href values have
         * remained unchanged across several checks.
         */

        if (
            stableChecks >=
            REQUIRED_STABLE_CHECKS
        ) {

            return;
        }


        await page.waitForTimeout(
            CHECK_INTERVAL
        );
    }
}


/*
=========================================================
SCAN PAGE
=========================================================
*/

async function scanPage(
    browser,
    url
) {

    const page =
        await browser.newPage({
            userAgent:
                USER_AGENT
        });


    try {

        page.setDefaultNavigationTimeout(
            PAGE_TIMEOUT
        );


        const response =
            await page.goto(
                url,
                {
                    waitUntil:
                        "domcontentloaded",

                    timeout:
                        PAGE_TIMEOUT
                }
            );


        /*
         * Allow JavaScript-rendered
         * content to appear.
         */

        await page.waitForTimeout(
            RENDER_WAIT
        );


        /*
         * NEW:
         *
         * Wait for actual anchor data to settle.
         *
         * This is intentionally done immediately
         * before extractAnchors().
         */

        await waitForAnchorsToSettle(
            page
        );


        const finalUrl =
            page.url();


        const rawAnchors =
            await extractAnchors(
                page
            );


        const anchors = [];


        for (
            const anchor
            of rawAnchors
        ) {

            /*
             * No href at all.
             *
             * This is different from
             * href="undefined".
             */

            if (
                !anchor.rawHref
            ) {

                continue;
            }


            /*
             * CRITICAL:
             *
             * Capture:
             *
             * <a href="undefined">
             *
             * as Broken.
             */

            if (
                anchor.isUndefinedHref
            ) {

                anchors.push({

                    ...anchor,

                    targetUrl:
                        "undefined",

                    forceBroken:
                        true
                });


                continue;
            }


            /*
             * Ignore mailto,
             * tel,
             * javascript etc.
             */

            if (
                shouldIgnore(
                    anchor.rawHref
                )
            ) {

                continue;
            }


            const targetUrl =
                normalizeUrl(
                    anchor.rawHref,
                    finalUrl
                );


            /*
             * Invalid URL.
             *
             * Keep it so it can be
             * reported as Broken.
             */

            if (!targetUrl) {

                anchors.push({

                    ...anchor,

                    targetUrl:
                        anchor.rawHref,

                    forceBroken:
                        true
                });


                continue;
            }


            anchors.push({

                ...anchor,

                targetUrl,

                forceBroken:
                    false
            });
        }


        return {

            pageUrl:
                url,

            finalUrl,

            pageStatusCode:
                response?.status() || 0,

            pageError:
                "",

            anchors
        };


    } catch (error) {

        console.error(
            `Page scan failed: ${url}`,
            error.message
        );


        return {

            pageUrl:
                url,

            finalUrl:
                url,

            pageStatusCode:
                0,

            pageError:
                error.message,

            anchors:
                []
        };


    } finally {

        await page.close();
    }
}


/*
=========================================================
STATUS HELPERS
=========================================================
*/

function isBrokenStatus(status) {

    return (
        status === 404 ||
        status === 410
    );
}


function isAccessRestrictedStatus(
    status
) {

    return (

        status === 401 ||
        status === 403 ||
        status === 429
    );
}


function isServerErrorStatus(
    status
) {

    return (
        status >= 500 &&
        status <= 599
    );
}


/*
=========================================================
HTTP LINK CHECK
=========================================================
*/

async function httpCheck(url) {

    const started =
        Date.now();


    const controller =
        new AbortController();


    const timer =
        setTimeout(
            () =>
                controller.abort(),
            LINK_TIMEOUT
        );


    try {

        const response =
            await fetch(
                url,
                {

                    method:
                        "GET",

                    redirect:
                        "follow",

                    signal:
                        controller.signal,

                    headers: {

                        "User-Agent":
                            USER_AGENT,

                        "Accept":
                            "text/html,application/xhtml+xml,application/xml,*/*",

                        "Accept-Language":
                            "en-US,en;q=0.9",

                        "Cache-Control":
                            "no-cache"
                    }
                }
            );


        const status =
            response.status;


        const finalUrl =
            response.url ||
            url;


        const responseTimeMs =
            Date.now() -
            started;


        /*
         * 2xx
         */

        if (
            status >= 200 &&
            status < 300
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    "valid",

                validationMethod:
                    "HTTP",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    ""
            };
        }


        /*
         * 3xx
         */

        if (
            status >= 300 &&
            status < 400
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    "redirect",

                validationMethod:
                    "HTTP",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    ""
            };
        }


        /*
         * 404 / 410
         */

        if (
            isBrokenStatus(
                status
            )
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    "broken",

                validationMethod:
                    "HTTP",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    `HTTP ${status} - resource not found`
            };
        }


        /*
         * 401 / 403 / 429
         */

        if (
            isAccessRestrictedStatus(
                status
            )
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    "access_restricted",

                validationMethod:
                    "HTTP",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    `HTTP ${status} - automated access restricted`
            };
        }


        /*
         * 5xx
         */

        if (
            isServerErrorStatus(
                status
            )
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    "server_error",

                validationMethod:
                    "HTTP",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    `HTTP ${status} - server error`
            };
        }


        /*
         * Other 4xx.
         */

        if (
            status >= 400 &&
            status < 500
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    "unable_to_validate",

                validationMethod:
                    "HTTP",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    `HTTP ${status}`
            };
        }


        return null;


    } catch (error) {

        return {

            statusCode:
                0,

            validationStatus:
                "unable_to_validate",

            validationMethod:
                "HTTP",

            finalUrl:
                url,

            responseTimeMs:
                Date.now() -
                started,

            errorMessage:
                error.message ||
                "HTTP request failed"
        };


    } finally {

        clearTimeout(
            timer
        );
    }
}


/*
=========================================================
BROWSER LINK CHECK
=========================================================
*/

async function browserCheck(
    browser,
    url
) {

    const started =
        Date.now();


    const page =
        await browser.newPage({
            userAgent:
                USER_AGENT
        });


    try {

        page.setDefaultNavigationTimeout(
            LINK_TIMEOUT
        );


        const response =
            await page.goto(
                url,
                {
                    waitUntil:
                        "domcontentloaded",

                    timeout:
                        LINK_TIMEOUT
                }
            );


        const status =
            response?.status() || 0;


        const finalUrl =
            page.url();


        const responseTimeMs =
            Date.now() -
            started;


        /*
         * 2xx
         */

        if (
            status >= 200 &&
            status < 300
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    finalUrl !== url
                        ? "redirect"
                        : "valid",

                validationMethod:
                    "Browser",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    ""
            };
        }


        /*
         * 3xx
         */

        if (
            status >= 300 &&
            status < 400
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    "redirect",

                validationMethod:
                    "Browser",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    ""
            };
        }


        /*
         * 404 / 410
         */

        if (
            isBrokenStatus(
                status
            )
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    "broken",

                validationMethod:
                    "Browser",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    `HTTP ${status} - resource not found`
            };
        }


        /*
         * Restricted
         */

        if (
            isAccessRestrictedStatus(
                status
            )
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    "access_restricted",

                validationMethod:
                    "Browser",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    `Website returned HTTP ${status}; automated access is restricted`
            };
        }


        /*
         * Server errors.
         */

        if (
            isServerErrorStatus(
                status
            )
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    "server_error",

                validationMethod:
                    "Browser",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    `Website returned HTTP ${status}`
            };
        }


        /*
         * Other 4xx.
         */

        if (
            status >= 400 &&
            status < 500
        ) {

            return {

                statusCode:
                    status,

                validationStatus:
                    "unable_to_validate",

                validationMethod:
                    "Browser",

                finalUrl,

                responseTimeMs,

                errorMessage:
                    `Website returned HTTP ${status}`
            };
        }


        return {

            statusCode:
                status,

            validationStatus:
                "unable_to_validate",

            validationMethod:
                "Browser",

            finalUrl,

            responseTimeMs,

            errorMessage:
                "Browser did not receive a reliable HTTP response"
        };


    } catch (error) {

        return {

            statusCode:
                0,

            validationStatus:
                "unable_to_validate",

            validationMethod:
                "Browser",

            finalUrl:
                url,

            responseTimeMs:
                Date.now() -
                started,

            errorMessage:
                error.message ||
                "Browser could not validate the URL"
        };


    } finally {

        await page.close();
    }
}


/*
=========================================================
FINAL URL VALIDATION
=========================================================
*/

async function validateUrl(
    browser,
    url
) {

    /*
     * href="undefined"
     *
     * Never send this to fetch().
     */

    if (
        String(url)
            .trim()
            .toLowerCase() ===
        "undefined"
    ) {

        return {

            statusCode:
                0,

            validationStatus:
                "broken",

            validationMethod:
                "DOM",

            finalUrl:
                "undefined",

            responseTimeMs:
                0,

            errorMessage:
                'Invalid href detected: href="undefined"'
        };
    }


    console.log(
        `Checking: ${url}`
    );


    const httpResult =
        await httpCheck(
            url
        );


    if (!httpResult) {

        return await browserCheck(
            browser,
            url
        );
    }


    /*
     * VALID
     */

    if (
        httpResult.validationStatus ===
        "valid"
    ) {

        console.log(
            `RESULT: valid | ${httpResult.statusCode} | ${url}`
        );

        return httpResult;
    }


    /*
     * REDIRECT
     */

    if (
        httpResult.validationStatus ===
        "redirect"
    ) {

        console.log(
            `RESULT: redirect | ${httpResult.statusCode} | ${url}`
        );

        return httpResult;
    }


    /*
     * ACCESS RESTRICTED
     */

    if (
        httpResult.validationStatus ===
        "access_restricted"
    ) {

        console.log(
            `RESULT: access_restricted | ${httpResult.statusCode} | ${url}`
        );

        return httpResult;
    }


    /*
     * SERVER ERROR
     */

    if (
        httpResult.validationStatus ===
        "server_error"
    ) {

        const browserResult =
            await browserCheck(
                browser,
                url
            );


        if (
            browserResult.validationStatus ===
                "valid" ||

            browserResult.validationStatus ===
                "redirect"
        ) {

            return browserResult;
        }


        return {

            ...browserResult,

            validationStatus:
                "server_error",

            validationMethod:
                "HTTP + Browser"
        };
    }


    /*
     * 404 / 410
     */

    if (
        httpResult.validationStatus ===
        "broken"
    ) {

        const browserResult =
            await browserCheck(
                browser,
                url
            );


        if (
            browserResult.validationStatus ===
                "valid" ||

            browserResult.validationStatus ===
                "redirect"
        ) {

            return browserResult;
        }


        if (
            isBrokenStatus(
                browserResult.statusCode
            )
        ) {

            return {

                ...browserResult,

                validationStatus:
                    "broken",

                validationMethod:
                    "HTTP + Browser",

                errorMessage:
                    "Resource returned HTTP 404/410 from both HTTP and browser validation."
            };
        }


        return {

            ...browserResult,

            statusCode:
                httpResult.statusCode,

            validationStatus:
                "unable_to_validate",

            validationMethod:
                "HTTP + Browser",

            finalUrl:
                browserResult.finalUrl ||
                httpResult.finalUrl ||
                url,

            errorMessage:
                "HTTP returned 404/410, but browser validation could not independently confirm that the resource is unavailable."
        };
    }


    /*
     * Everything else.
     */

    return await browserCheck(
        browser,
        url
    );
}


/*
=========================================================
CONCURRENCY
=========================================================
*/

async function runConcurrent(
    items,
    worker,
    concurrency
) {

    const results =
        new Array(
            items.length
        );


    let index = 0;


    async function runner() {

        while (true) {

            const current =
                index++;


            if (
                current >=
                items.length
            ) {

                return;
            }


            try {

                results[current] =
                    await worker(
                        items[current],
                        current
                    );


            } catch (error) {

                console.error(
                    `Worker failed for ${items[current]}:`,
                    error.message
                );


                results[current] = {

                    statusCode:
                        0,

                    validationStatus:
                        "unable_to_validate",

                    validationMethod:
                        "HTTP + Browser",

                    finalUrl:
                        items[current],

                    responseTimeMs:
                        0,

                    errorMessage:
                        error.message ||
                        "Validation failed"
                };
            }
        }
    }


    const workers =
        Math.min(
            concurrency,
            Math.max(
                items.length,
                1
            )
        );


    await Promise.all(
        Array.from(
            {
                length:
                    workers
            },
            runner
        )
    );


    return results;
}


/*
=========================================================
MAIN SCAN
=========================================================
*/

async function runScan({
    sitemapUrl,
    sitemapXml,
    onProgress
}) {

    console.log("");

    console.log(
        "========================================"
    );

    console.log(
        "AUTOMATED BROKEN LINK VALIDATION"
    );

    console.log(
        "========================================"
    );


    const browser =
        await chromium.launch({

            headless:
                true,

            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage"
            ]

        });


    try {

        /*
         * LOAD SITEMAP
         */

        if (onProgress) {

            onProgress({

                phase:
                    "loading_sitemap",

                percent:
                    5

            });
        }


        const xml =
            sitemapXml ||
            await loadSitemap(
                sitemapUrl,
                browser
            );


        /*
         * EXTRACT PAGES
         */

        const pageUrls =
            extractSitemapUrls(
                xml
            );


        console.log(
            `Pages found: ${pageUrls.length}`
        );


        if (onProgress) {

            onProgress({

                phase:
                    "scanning_pages",

                pagesFound:
                    pageUrls.length,

                pagesScanned:
                    0,

                linksDiscovered:
                    0,

                percent:
                    10

            });
        }


        /*
         * SCAN ALL PAGES
         *
         * IMPORTANT:
         *
         * Do not reference "pages"
         * inside its own initializer.
         *
         * That was causing the
         * page.anchors / TDZ issues.
         */

        let pagesCompleted =
            0;


        const pages =
            await runConcurrent(

                pageUrls,

                async url => {

                    const result =
                        await scanPage(
                            browser,
                            url
                        );


                    pagesCompleted++;


                    console.log(
                        `Page: ${url} | Anchors: ${result.anchors.length}`
                    );


                    if (onProgress) {

                        const percent =
                            pageUrls.length > 0

                                ? Math.round(

                                    10 +

                                    (
                                        pagesCompleted /
                                        pageUrls.length
                                    ) *
                                    40

                                )

                                : 50;


                        /*
                         * Calculate links discovered
                         * from completed pages.
                         *
                         * We cannot use "pages" here
                         * because the array is still
                         * being created.
                         */

                        onProgress({

                            phase:
                                "scanning_pages",

                            pagesFound:
                                pageUrls.length,

                            pagesScanned:
                                pagesCompleted,

                            linksDiscovered:
                                result.anchors.length,

                            percent
                        });
                    }


                    return result;
                },

                4

            );


        /*
         * BUILD DISCOVERED LINKS
         */

        const discovered = [];


        for (
            const page
            of pages
        ) {

            /*
             * Safety check.
             */

            if (
                !Array.isArray(
                    page.anchors
                )
            ) {

                continue;
            }


            for (
                const anchor
                of page.anchors
            ) {

                discovered.push({

                    sourcePage:
                        page.pageUrl,

                    sourceFinalPage:
                        page.finalUrl,

                    anchorText:
                        anchor.anchorText,

                    rawHref:
                        anchor.rawHref,

                    targetUrl:
                        anchor.targetUrl,

                    linkType:
                        anchor.forceBroken

                            ? "Internal"

                            : getLinkType(
                                anchor.targetUrl,
                                page.finalUrl
                            ),

                    forceBroken:
                        anchor.forceBroken ||
                        false

                });

            }

        }


        /*
         * UNIQUE URLS
         */

        const uniqueUrls = [

            ...new Set(

                discovered.map(

                    item =>
                        item.targetUrl

                )

            )

        ];


        console.log(
            `Anchors discovered: ${discovered.length}`
        );


        console.log(
            `Unique URLs: ${uniqueUrls.length}`
        );


        if (onProgress) {

            onProgress({

                phase:
                    "validating_links",

                pagesFound:
                    pageUrls.length,

                pagesScanned:
                    pages.length,

                linksDiscovered:
                    discovered.length,

                uniqueLinks:
                    uniqueUrls.length,

                linksValidated:
                    0,

                percent:
                    50

            });

        }


        /*
         * VALIDATE UNIQUE URLS
         */

        const validationMap =
            new Map();


        let linksValidated =
            0;


        await runConcurrent(

            uniqueUrls,

            async url => {

                let result;


                /*
                 * Find matching item.
                 */

                const matchingItem =
                    discovered.find(

                        item =>
                            item.targetUrl ===
                            url

                    );


                /*
                 * DOM BROKEN LINK
                 */

                if (

                    matchingItem &&

                    matchingItem.forceBroken

                ) {

                    result = {

                        statusCode:
                            0,

                        validationStatus:
                            "broken",

                        validationMethod:
                            "DOM",

                        finalUrl:
                            url,

                        responseTimeMs:
                            0,

                        errorMessage:

                            url ===
                            "undefined"

                                ? 'Invalid href detected: href="undefined"'

                                : "Invalid href detected"

                    };


                    console.log(
                        `RESULT: broken | DOM | ${url}`
                    );


                } else {

                    result =
                        await validateUrl(
                            browser,
                            url
                        );

                }


                validationMap.set(
                    url,
                    result
                );


                linksValidated++;


                const percent =
                    uniqueUrls.length > 0

                        ? Math.round(

                            50 +

                            (
                                linksValidated /
                                uniqueUrls.length
                            ) *
                            50

                        )

                        : 100;


                console.log(
                    `Link validation: ${linksValidated}/${uniqueUrls.length} ${percent}% | ${url}`
                );


                if (onProgress) {

                    onProgress({

                        phase:
                            "validating_links",

                        pagesFound:
                            pageUrls.length,

                        pagesScanned:
                            pages.length,

                        linksDiscovered:
                            discovered.length,

                        uniqueLinks:
                            uniqueUrls.length,

                        linksValidated,

                        percent

                    });

                }


                return result;

            },

            6

        );


        /*
         * ATTACH RESULTS
         */

        const results =
            discovered.map(

                item => ({

                    ...item,

                    ...(

                        validationMap.get(
                            item.targetUrl
                        )

                        ||

                        {

                            statusCode:
                                0,

                            validationStatus:
                                "unable_to_validate",

                            validationMethod:
                                "HTTP + Browser",

                            finalUrl:
                                item.targetUrl,

                            responseTimeMs:
                                0,

                            errorMessage:
                                "No validation result available"

                        }

                    )

                })

            );


        /*
         * SUMMARY
         */

        const summary = {

            pagesFound:
                pageUrls.length,

            pagesScanned:
                pages.length,

            pagesWithErrors:

                pages.filter(

                    page =>
                        page.pageError

                ).length,

            linksDiscovered:
                results.length,

            uniqueLinksChecked:
                uniqueUrls.length,

            valid:

                results.filter(

                    result =>

                        result.validationStatus ===
                        "valid"

                ).length,

            redirects:

                results.filter(

                    result =>

                        result.validationStatus ===
                        "redirect"

                ).length,

            broken:

                results.filter(

                    result =>

                        result.validationStatus ===
                        "broken"

                ).length,

            accessRestricted:

                results.filter(

                    result =>

                        result.validationStatus ===
                        "access_restricted"

                ).length,

            serverErrors:

                results.filter(

                    result =>

                        result.validationStatus ===
                        "server_error"

                ).length,

            unableToValidate:

                results.filter(

                    result =>

                        result.validationStatus ===
                        "unable_to_validate"

                ).length,

            internalLinks:

                results.filter(

                    result =>

                        result.linkType ===
                        "Internal"

                ).length,

            externalLinks:

                results.filter(

                    result =>

                        result.linkType ===
                        "External"

                ).length

        };


        /*
         * FINAL PROGRESS
         */

        if (onProgress) {

            onProgress({

                phase:
                    "completed",

                pagesFound:
                    pageUrls.length,

                pagesScanned:
                    pages.length,

                linksDiscovered:
                    discovered.length,

                uniqueLinks:
                    uniqueUrls.length,

                linksValidated:
                    uniqueUrls.length,

                percent:
                    100

            });

        }


        console.log("");


        console.log(
            "========================================"
        );


        console.log(
            "SCAN COMPLETED"
        );


        console.log(

            JSON.stringify(

                summary,

                null,

                2

            )

        );


        console.log(
            "========================================"
        );


        return {

            scanId:
                `scan-${Date.now()}`,

            sitemapUrl,

            createdAt:
                new Date().toISOString(),

            summary,

            pageErrors:

                pages.filter(

                    page =>
                        page.pageError

                ),

            results

        };


    } finally {

        await browser.close();


        console.log(
            "Chromium browser closed."
        );

    }

}


/*
=========================================================
EXPORT
=========================================================
*/

module.exports = {
    runScan
};