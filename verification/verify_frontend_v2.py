
from playwright.sync_api import Page, expect, sync_playwright
import os

def test_smart_repair_dropdown(page: Page):
    # Load the mock HTML file
    cwd = os.getcwd()
    file_path = f"file://{cwd}/mock_preview.html"
    print(f"Navigating to: {file_path}")
    page.goto(file_path)

    # Check for Win95 Container
    expect(page.locator(".compu-container")).to_be_visible()

    # Take a screenshot
    output_path = "verification/smart_repair_verification.png"
    print(f"Taking screenshot to: {output_path}")
    page.screenshot(path=output_path)

if __name__ == "__main__":
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            test_smart_repair_dropdown(page)
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()
