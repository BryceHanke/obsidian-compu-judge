
from playwright.sync_api import Page, expect, sync_playwright
import os

def test_critical_failure_style(page: Page):
    # Get the absolute path to the mock file
    mock_path = os.path.abspath("verification/mocks/mock_critical_failure.html")
    file_url = f"file://{mock_path}"

    page.goto(file_url)

    # Locate the critical bar
    bar = page.locator(".critical-bar")

    # Assert that it exists
    expect(bar).to_be_visible()

    # Take a screenshot for visual verification
    page.screenshot(path="verification/critical_failure_check.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_critical_failure_style(page)
            print("Screenshot saved to verification/critical_failure_check.png")
        finally:
            browser.close()
