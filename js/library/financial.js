// js/library/financial.js
// Financial function library for loan and banking calculations

(function() {
  'use strict';

  // Function registry
  const functions = {
    untilMaturity: {
      description: "Calculates months until maturity date from a given maturity date string",
      entities: ["loans"],
      returnType: "currency",
      implementation: function(maturity) {
        if (!maturity) return { monthsUntilMaturity: 0 };
        const maturityDate = new Date(maturity);
        const now = new Date();
        if (isNaN(maturityDate.getTime())) return { monthsUntilMaturity: 0 };
        
        const years = (maturityDate.getFullYear() - now.getFullYear());
        const months = (maturityDate.getMonth() - now.getMonth());
        const totalMonths = years * 12 + months;
        return { monthsUntilMaturity: Math.max(0, totalMonths) };
      }
    },

    averagePrincipal: {
      description: "Calculates the average balance of a loan over its term using maturity date",
      entities: ["loans"],
      returnType: "currency",
      implementation: function(principal, payment, rate, maturity, term, sourceIndex) {
        if (!principal || principal <= 0) return 0;
        
        // Convert to numbers
        principal = parseFloat(principal);
        payment = payment ? parseFloat(payment) : 0;
        rate = rate ? parseFloat(rate) : 0;
        
        // Use term directly if available, otherwise use untilMaturity
        let monthsUntilMaturity;
        if (term && term > 0) {
          monthsUntilMaturity = parseFloat(term);
        } else if (maturity) {
          const untilMaturityFunc = functions.untilMaturity;
          if (untilMaturityFunc) {
            const maturityResult = untilMaturityFunc.implementation(maturity);
            monthsUntilMaturity = maturityResult.monthsUntilMaturity;
          } else {
            // Fallback: calculate from maturity date
            const maturityDate = new Date(maturity);
            const now = new Date();
            if (!isNaN(maturityDate.getTime())) {
              const years = (maturityDate.getFullYear() - now.getFullYear());
              const months = (maturityDate.getMonth() - now.getMonth());
              monthsUntilMaturity = Math.max(0, years * 12 + months);
            } else {
              monthsUntilMaturity = 0;
            }
          }
        } else {
          monthsUntilMaturity = 0;
        }
        
        // If no valid term, return principal
        if (monthsUntilMaturity <= 0) return principal;
        
        // Calculate monthly interest rate
        const monthlyRate = rate < 1 ? rate / 12 : (rate / 100) / 12;
        
        // If payment is not provided or seems wrong, calculate approximate monthly payment
        let monthlyPayment = payment;
        if (!monthlyPayment || monthlyPayment <= 0) {
          // Approximate: use amortization formula if we have rate
          if (rate > 0 && monthsUntilMaturity > 0) {
            const r = monthlyRate;
            const n = monthsUntilMaturity;
            if (r > 0) {
              monthlyPayment = principal * (r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1);
            } else {
              monthlyPayment = principal / n;
            }
          } else {
            // Fallback: assume payment covers interest + some principal
            monthlyPayment = principal * monthlyRate * 1.1; // 10% more than interest
          }
        }
        
        let cummulativePrincipal = 0;
        let tempPrincipal = principal;
        let month = 0;
        
        while (month < monthsUntilMaturity && tempPrincipal > 0) {
          cummulativePrincipal += tempPrincipal;
          
          // Calculate interest for this month
          const interest = tempPrincipal * monthlyRate;
          // Principal reduction is payment minus interest
          const principalReduction = monthlyPayment - interest;
          
          // Update principal
          tempPrincipal = Math.max(0, tempPrincipal - principalReduction);
          
          month++;
        }
        
        if (month === 0) return principal;
        
        const averagePrincipal = cummulativePrincipal / month;
        return parseFloat(averagePrincipal.toFixed(2));
      }
    },

    loanProfit: {
      description: "Calculates profit (interest earned) on a loan given principal, rate, and optional term in months",
      entities: ["loans"],
      returnType: "currency",
      implementation: function(principal, rate, termMonths) {
        // Validate inputs
        if (principal == null || rate == null) return 0;

        // Normalize numeric inputs (strip currency/percent symbols/commas)
        const toNumber = (v) => {
          if (v == null) return NaN;
          return Number(String(v).replace(/[^0-9.\-]/g, ""));
        };

        const p = toNumber(principal);
        let r = toNumber(rate);
        let months = termMonths ? toNumber(termMonths) : 12;

        if (Number.isNaN(p) || Number.isNaN(r) || p <= 0) return 0;

        // Convert percent to decimal if needed
        if (r > 1) {
          r = r / 100;
        }

        // Term defaults to 12 months if not provided or invalid
        if (Number.isNaN(months) || months <= 0) months = 12;
        // Clamp to reasonable range to avoid runaway profits
        months = Math.max(1, Math.min(months, 360));

        // Simple interest approximation: principal * rate * (months / 12)
        const profit = p * r * (months / 12);
        return parseFloat(profit.toFixed(2));
      }
    }
  };

  // Expose the library
  if (typeof window.FunctionLibrary === 'undefined') {
    window.FunctionLibrary = {};
  }
  
  window.FunctionLibrary.financial = {
    functions: functions,
    name: 'financial',
    description: 'Financial calculations for loans and banking'
  };
})();
