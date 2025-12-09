from playwright.sync_api import sync_playwright

def verify_wizard_ui():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the mock wizard HTML file
        # Note: We need to use file:// protocol and absolute path
        import os
        cwd = os.getcwd()
        page.goto(f"file://{cwd}/verification/mock_wizard.html")

        # Take a screenshot
        screenshot_path = f"{cwd}/verification/wizard_ui.png"
        page.screenshot(path=screenshot_path, full_page=True)

        print(f"Screenshot saved to {screenshot_path}")
        browser.close()

if __name__ == "__main__":
    verify_wizard_ui()
