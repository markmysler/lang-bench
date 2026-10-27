# 04-pdf-reports

**Team:** startup-ts

## Situation

Customers download monthly reports as PDFs with charts. Rendering one takes about 400 ms of CPU
in the current prototype, which runs inside the Express API. At month end, about 3,000 customers
download theirs within a few hours, and the API's other endpoints slow down while it happens.

## The request

> Our API gets slow when reports are generated. How should we restructure this, and should the report service be in a different language?
