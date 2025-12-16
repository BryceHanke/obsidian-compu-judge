
import os
from playwright.sync_api import sync_playwright

def verify_grading_panel():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Load the mock HTML file
        mock_path = os.path.abspath("verification/mocks/mock_grading_panel.html")
        page.goto(f"file://{mock_path}")

        # Check for the new button label "LOAD KNOWLEDGE"
        knowledge_btn = page.get_by_text("LOAD KNOWLEDGE")

        # Verify it's visible
        if knowledge_btn.is_visible():
            print("SUCCESS: 'LOAD KNOWLEDGE' button is visible.")
        else:
            print("FAILURE: 'LOAD KNOWLEDGE' button not found.")

        # Take a screenshot
        os.makedirs("verification/screenshots", exist_ok=True)
        page.screenshot(path="verification/screenshots/grading_panel_knowledge.png")

        browser.close()

if __name__ == "__main__":
    verify_grading_panel()
