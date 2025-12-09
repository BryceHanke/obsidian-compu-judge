
from playwright.sync_api import Page, expect, sync_playwright
import os

def test_smart_repair_dropdown(page: Page):
    # Load the mock HTML file
    cwd = os.getcwd()
    file_path = f"file://{cwd}/mock_preview.html"
    page.goto(file_path)

    # Note: Since the mock_preview.html is static and doesn't contain the Svelte interactivity
    # we cannot fully verify the dropdown open/close behavior.
    # However, we can verify that the Win95 styling is present as expected.

    # Check for Win95 Container
    expect(page.locator(".compu-container")).to_be_visible()

    # Check for Title Bar
    expect(page.locator(".title-bar")).to_be_visible()
    expect(page.locator(".title-bar")).to_have_css("background-image", "linear-gradient(90deg, rgb(0, 0, 128) 0%, rgb(16, 132, 208) 100%)")

    # Check for Quick Scan Window
    expect(page.locator(".win95-popup-window").first).to_be_visible()

    # Take a screenshot
    page.screenshot(path="/home/jules/verification/smart_repair_verification.png")

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_smart_repair_dropdown(page)
        finally:
            browser.close()
