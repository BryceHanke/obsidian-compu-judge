
from playwright.sync_api import sync_playwright

def verify_wizard_styling():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the mock wizard
        page.goto('http://localhost:8080/mock_wizard.html')

        # Screenshot the wizard
        page.screenshot(path='verification/wizard_preview.png')

        browser.close()

if __name__ == '__main__':
    verify_wizard_styling()
