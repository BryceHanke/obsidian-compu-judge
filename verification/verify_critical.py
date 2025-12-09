from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        # Load local html file
        page.goto(f"file://{os.path.abspath('verification/test_critical.html')}")
        page.screenshot(path="verification/critical_failure.png")
        browser.close()

if __name__ == "__main__":
    run()
