# Sample Prompts for Curiosity AI

This document contains examples of natural language queries you can use with the Curiosity AI system. The AI can query multiple data sources including loans, checking accounts, branches, and customer data.

## 📊 Statistical Queries

### Basic Statistics
```
"average balance of loans"
"mean loan amount"
"total loan principal"
"maximum loan balance"
"minimum checking balance"
"standard deviation of loan rates"
"count of customers"
"sum of all loan amounts"
```

### Advanced Statistical Queries
```
"average balance of loans over $10,000"
"mean checking balance for customers in branch 3"
"standard deviation of loan rates by branch"
"total principal of loans closed in the last 6 months"
"count of checking accounts with balance over $5,000"
```

## 🔍 Basic Data Queries

### Single Entity Queries
```
"show me all loans"
"find checking accounts"
"list all branches"
"display customer information"
"show loan details"
```

### Filtered Queries
```
"show loans over $5,000"
"find checking accounts with balance under $100"
"list branches in California"
"show customers with accounts opened after 2020"
"find loans with rate above 5%"
```

## 🎯 Specific Field Queries

### Loan Queries
```
"show loan principal amounts"
"find loans by branch number"
"display loan maturity dates"
"show loan rates and terms"
"find loans with high risk ratings"
```

### Checking Account Queries
```
"show checking balances"
"find checking accounts by customer"
"display checking transaction counts"
"show checking account open dates"
```

### Branch Queries
```
"show branch names"
"find branches by number"
"display branch locations"
"show branch performance metrics"
```

## 🔗 Multi-Entity Queries

### Cross-Entity Analysis
```
"show loans and checking accounts for customer 12345"
"find loans and checking accounts in branch number 4"
"display checking balances by branch"
"show customer loans and account balances"
```

### Joined Data Queries
```
"show loan amounts with branch information"
"find customers with loans over $50,000"
"display branch performance with loan data"
"show checking accounts linked to loans"
```

## 📅 Date-Based Queries

### Time Range Queries
```
"show loans opened in the last 6 months"
"find checking accounts opened this year"
"display loans closed in 2023"
"show accounts opened after January 2024"
```

### Specific Date Queries
```
"show loans opened on 2024-01-15"
"find accounts closed before 2023-12-31"
"display loans maturing in 2025"
```

## 🔢 Numeric Condition Queries

### Range Queries
```
"show loans between $1,000 and $10,000"
"find checking accounts with balance from $500 to $5,000"
"display loans with rates between 3% and 6%"
```

### Comparison Queries
```
"show loans over $25,000"
"find checking accounts under $50"
"display loans with rate above 4.5%"
"show accounts with balance greater than $10,000"
```

## 🏢 Branch-Specific Queries

### Branch Filtering
```
"show loans in branch 4"
"find checking accounts at branch number 2"
"display customers in branch 7"
"show loan officers at branch 3"
```

### Branch Analysis
```
"show all branches and their loan totals"
"find branches with highest loan volumes"
"display branch performance metrics"
"show branch customer counts"
```

## 🌐 Translator-Based Queries (names → IDs)

These use institution-defined translators loaded at startup (`translator/custom_translator.js`). Names are matched case-insensitively, and synonyms from translator metadata (e.g., "location" for branches, "rm" for officers) are honored.

```
"show loans in the Lakeside branch"              // branch name → branch id
"show loans in the Brookside branch"             // name → id, inferred condition
"show loans in branch 4"                         // numeric branch id
"show loans assigned to Hannah Martinez"         // officer name → officer id
"show loans managed by rm #92"                   // officer numeric id
"show loans for location Meadowvale"             // uses branch synonyms
```

## 💰 Financial Calculations

### Loan Calculations
```
"calculate average principal"
"find average balance over loan term"
"compute months until maturity"
"calculate loan payment amounts"
"find average loan balance over time"
```

### Advanced Financial Queries
```
"show average principal balance over loan terms"
"find loans with average balance above $15,000"
"display months remaining until maturity"
"calculate loan amortization schedules"
```

## 👥 Customer Queries

### Customer Data
```
"show customer information"
"find customers by ID"
"display customer account details"
"show customer loan history"
```

### Customer Analytics
```
"show customers with multiple accounts"
"find customers with high balances"
"display customer risk profiles"
"show customer account ages"
```

## 📈 Advanced Analytical Queries

### Complex Conditions
```
"show loans over $10,000 with rates above 4% in branch 4"
"find checking accounts under $100 opened in the last month"
"display customers with loans and checking balances over $5,000"
```

### Multi-Criteria Analysis
```
"show loans with principal over $50,000 and maturity within 2 years"
"find checking accounts with high transaction counts and low balances"
"display branches with loan volumes over $1M and customer counts over 100"
```

## 🎯 Query Tips

### Best Practices
- Use natural language (e.g., "show me", "find", "list", "display")
- Be specific about what you want to see
- Include conditions to filter results
- Use entity names (loans, checking, branches, customers)
- Combine multiple criteria for detailed analysis

### Supported Operations
- **Statistical**: mean, average, min, max, count, sum, standard deviation, median, variance
- **Financial**: average principal, months until maturity, loan calculations
- **Comparisons**: over, under, above, below, greater than, less than
- **Ranges**: between X and Y
- **Dates**: after, before, in the last X months/years, opened/closed/matured before/after date
- **Text**: contains, starts with, ends with (for applicable fields)

### Data Sources
- **Loans**: Principal, Rate, Maturity Date, Branch, Risk Rating, etc.
- **Checking**: Balance, Open Date, Branch, Transaction Count, etc.
- **Branches**: Branch Number, Name, Location, Performance Metrics
- **Customers**: Customer ID, Account Types, Risk Profiles, etc.

## 🚀 Getting Started

Try these sample queries to explore your data:

1. `"show me all loans"` - Basic listing
2. `"average loan balance"` - Simple statistics
3. `"show loans over $5,000 in branch 4"` - Filtered query
4. `"find loans and checking accounts in branch number 4"` - Multi-entity filtering
5. `"find checking accounts with balances above $1,000"` - Filtered checking query
6. `"calculate average principal"` - Financial calculations

**New Features:**
- **Dynamic Function Discovery**: Financial and analytical functions are automatically discoverable from function libraries
- **Advanced Statistical Operations**: Support for median and variance calculations
- **Enhanced Range Queries**: "between X and Y" conditions now work reliably
- **Multi-Source Queries**: Combine data from multiple sources in single queries
- **Intelligent Concept Mapping**: Recognizes noun adjunct patterns (e.g., "branch number", "account id")
- **Prompt History & Analytics**: Click the logo to view query history with confidence scores and success rates

The AI will automatically determine which data sources to query and how to join the information based on your natural language request!
