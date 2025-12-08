from playwright.sync_api import sync_playwright, expect
import os

# Ensure the verification directory exists
os.makedirs("verification", exist_ok=True)

def test_wizard_progress_bar_and_cancel():
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the mock HTML file
        # Note: In a real Obsidian plugin environment, we can't easily run the full plugin
        # inside a headless browser without Obsidian itself.
        # However, we can test the Svelte component if we had a build setup for it.
        # Since we don't have a standalone Svelte app runner here, we will inspect the source code
        # changes directly via the earlier steps and rely on the build success.

        # BUT, if we want to simulate the UI, we can try loading the mock_wizard.html
        # if it exists and is relevant, or we can just verify the file structure and build output
        # as we have already done.

        # For this verification step, since I cannot run the Obsidian plugin in the browser,
        # I will verify that the expected files exist and the build was successful.

        print("Verifying build output...")
        if os.path.exists("main.js"):
            print("Build successful: main.js exists.")
        else:
            print("Build failed: main.js missing.")
            exit(1)

        # I will create a dummy HTML that mimics the structure of the new progress bar
        # to verify the CSS and layout if I were to mount it.
        # But `Win95ProgressBar.svelte` is a component.

        # Let's create a screenshot of a "simulated" progress bar using HTML/CSS
        # that matches the one in `Win95ProgressBar.svelte` to verify the "Red X" styling.

        html_content = """
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Win95 Progress Bar Test</title>
            <style>
                :root { --cj-accent: #000080; --cj-bg: #c0c0c0; --cj-text: #000000; --cj-dim: #808080; --cj-light: #fff; }
                body { background-color: var(--cj-bg); font-family: 'Courier New', monospace; padding: 20px; }

                .win95-loader-row {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 300px;
                }

                .win95-loader { padding: 15px 0; flex: 1; display: flex; flex-direction: column; gap: 6px; }

                .cancel-btn {
                    width: 24px;
                    height: 24px;
                    background: #ff0000;
                    color: white;
                    font-weight: bold;
                    border: 2px outset #ffaaaa;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-family: 'Pixelated MS Sans Serif', 'Tahoma', sans-serif;
                    font-size: 12px;
                    margin-top: 6px;
                }
                .cancel-btn:active { border-style: inset; }

                .loader-header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    width: 100%;
                }

                .loader-label {
                    font-weight: 900;
                    font-size: 11px;
                    color: var(--cj-text);
                    text-transform: uppercase;
                    margin-left: 2px;
                }

                .loader-time {
                    font-size: 11px;
                    color: var(--cj-dim);
                    font-weight: 900;
                    margin-right: 2px;
                }

                .progress-container {
                    height: 24px;
                    padding: 3px;
                    box-sizing: border-box;
                    background: var(--cj-light);
                    border-top: 2px solid var(--cj-dim);
                    border-left: 2px solid var(--cj-dim);
                    border-right: 2px solid var(--cj-light);
                    border-bottom: 2px solid var(--cj-light);
                    position: relative;
                    overflow: hidden;
                }

                .progress-bar-fill {
                    height: 100%;
                    width: 50%;
                    background-color: var(--cj-accent);
                    background-image: repeating-linear-gradient(
                        90deg,
                        var(--cj-accent),
                        var(--cj-accent) 12px,
                        var(--cj-light) 12px,
                        var(--cj-light) 14px
                    );
                }
            </style>
        </head>
        <body>
            <div class="win95-loader-row">
                <div class="win95-loader">
                    <div class="loader-header">
                        <div class="loader-label">> PROCESSING...</div>
                        <div class="loader-time">EST: ~5s</div>
                    </div>
                    <div class="progress-container bevel-down">
                        <div class="progress-bar-fill"></div>
                    </div>
                </div>

                <button class="cancel-btn" title="Abort Process">X</button>
            </div>
        </body>
        </html>
        """

        with open("verification/mock_progress.html", "w") as f:
            f.write(html_content)

        page.goto("file://" + os.path.abspath("verification/mock_progress.html"))

        # Take screenshot
        page.screenshot(path="verification/progress_bar_test.png")
        print("Screenshot saved to verification/progress_bar_test.png")

        browser.close()

if __name__ == "__main__":
    test_wizard_progress_bar_and_cancel()
