import asyncio
from playwright.async_api import async_playwright

async def verify_progress_bar():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # Load the mock wizard directly
        await page.goto("file:///app/mock_wizard.html")

        # Wait for the wizard to load
        await page.wait_for_selector(".wizard-view-container")

        # Take a screenshot of the initial state
        await page.screenshot(path="verification/wizard_initial.png")

        # We can try to simulate a progress bar if the mock allows it,
        # but since we modified Svelte components, the static mock might not reflect dynamic Svelte changes
        # unless it imports the compiled Svelte code (which it likely doesn't).
        # However, checking if the styling and layout are unbroken is valuable.

        # Capture the progress bar area if visible
        try:
            await page.wait_for_selector(".win95-loader-row", timeout=1000)
            await page.screenshot(path="verification/progress_bar.png")
        except:
            print("Progress bar not visible in static mock")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_progress_bar())
