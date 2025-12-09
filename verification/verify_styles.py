from playwright.sync_api import sync_playwright
import os

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the test_critical.html which links to styles.css
        # absolute path needed
        cwd = os.getcwd()
        file_url = f"file://{cwd}/verification/test_critical.html"
        print(f"Navigating to {file_url}")

        page.goto(file_url)

        # Take a screenshot of the FIRST critical bar (wrapper style)
        element = page.locator(".critical-bar").first
        element.screenshot(path="verification/critical_bar_test_1.png")

        # Take a screenshot of the SECOND critical bar (container style)
        element2 = page.locator(".critical-bar").nth(1)
        element2.screenshot(path="verification/critical_bar_test_2.png")

        # Also take a full page screenshot
        page.screenshot(path="verification/full_page_test.png")

        browser.close()

if __name__ == "__main__":
    run()
