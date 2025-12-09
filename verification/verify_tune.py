from playwright.sync_api import sync_playwright

def verify_tune_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()

        # Load the mock_preview.html file.
        page.goto("file:///app/mock_preview.html")

        # Inject the new button manually to test styling
        page.evaluate("""
            const container = document.querySelector('.compu-container > div');
            const button = document.createElement('button');
            button.className = 'win95-btn';
            button.style.width = '100%';
            button.style.marginBottom = '20px';
            button.innerText = '💾 SAVE PLAN AS DOCUMENT';

            // Inject after the Quick Scan mock
            const quickScan = document.querySelector('.win95-popup-window');
            quickScan.after(button);
        """)

        # Take a screenshot
        page.screenshot(path="verification/tune_view.png")

if __name__ == "__main__":
    verify_tune_ui()
