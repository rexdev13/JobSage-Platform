# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: synthetic-role-matrix.spec.ts >> synthetic authenticated role matrix >> employer owner: organization route and API permission checks
- Location: e2e/synthetic-role-matrix.spec.ts:241:5

# Error details

```
Test timeout of 90000ms exceeded.
```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e2]:
    - generic [ref=e3]:
      - banner [ref=e6]:
        - button "JOBSAGE" [ref=e7]:
          - img "JOBSAGE" [ref=e8]
      - main [ref=e9]:
        - generic [ref=e11]:
          - heading "Set new password" [level=2] [ref=e12]
          - paragraph [ref=e13]: Choose a strong password for your JOBSAGE account.
          - generic [ref=e14]:
            - img [ref=e15]
            - generic [ref=e17]:
              - text: Invalid reset link.
              - link "Request a new one" [ref=e18] [cursor=pointer]:
                - /url: /forgot-password
              - text: .
          - generic [ref=e19]:
            - generic [ref=e20]:
              - generic [ref=e21]: New password
              - generic [ref=e22]:
                - textbox "Min. 8 characters" [ref=e23]: Dev!G7WksDPq0mp1tdCT3_yGno2AwaoaA7
                - button [ref=e24]:
                  - img [ref=e25]
            - generic [ref=e28]:
              - generic [ref=e29]: Confirm new password
              - textbox "Repeat your password" [active] [ref=e30]: Dev!G7WksDPq0mp1tdCT3_yGno2AwaoaA7
            - button "Update password" [disabled]
    - button "Open quick help" [ref=e32]:
      - img [ref=e33]
    - region "Notifications (F8)":
      - list
  - generic [ref=e36]:
    - generic [ref=e37]:
      - text: This is a temporary development preview, and these links are not for public use.
      - link "Publish your app" [ref=e38] [cursor=pointer]:
        - /url: https://docs.replit.com/category/replit-deployments?ref=replit-dev-banner
      - text: for secure sharing or use an invite link.
    - button "Close banner" [ref=e39] [cursor=pointer]:
      - img [ref=e40]
```