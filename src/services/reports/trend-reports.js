'use strict';

/** Trends and insights: activity by semester and academic year, and period-over-period comparisons. */

const { SECTORS } = require('../../domain/enums');
const { PALETTE, changeLabel } = require('./chart-data');
const {
  academicYearOf,
  academicYearFromKey,
  academicYearForSemester,
  semesterOf,
  semesterFromKey,
  baseComparisonPeriod,
  previousComparisonPeriod,
} = require('./periods');

/** Report label → key of reportsRepository.periodMetrics(), in display order. */
const PERIOD_METRICS = [
  ['Companies Engaged', 'companiesEngaged'],
  ['New Companies Added', 'newCompanies'],
  ['Recruitment Postings', 'recruitmentPostings'],
  ['Career Events Attended', 'careerEventsAttended'],
  ['Students Hired', 'studentsHired'],
  ['Academic Engagements', 'academicEngagements'],
  ['Outreach Interactions', 'outreachInteractions'],
];

/** Activity sources of the activity mix report, with their colours, in display order. */
const ACTIVITY_MIX_SOURCES = [
  { key: 'outreach', label: 'Outreach', color: '#4361ee' },
  { key: 'recruitment', label: 'Recruitment', color: '#0dcaf0' },
  { key: 'careerEvents', label: 'Career Events', color: '#7209b7' },
  { key: 'academic', label: 'Academic', color: '#ff9f1c' },
  { key: 'studentEvents', label: 'Student Events', color: '#f72585' },
  { key: 'hires', label: 'Hires', color: '#198754' },
];

const sum = (values) => values.reduce((total, value) => total + value, 0);

/** The labelled metrics of one period, in PERIOD_METRICS order. */
function periodMetrics(queries, range) {
  const values = queries.periodMetrics(range);
  return Object.fromEntries(PERIOD_METRICS.map(([label, key]) => [label, values[key]]));
}

module.exports = {
  // Engagement counts per semester and industry across postings, attended events and outreach.
  'industry-trends': (ctx) => {
    const { queries, from, to } = ctx;
    const activity = queries.industryActivity(from, to);
    const toEvents = (rows, kind) =>
      rows
        .map((row) => ({ sem: semesterOf(row.d), industry: row.industry || 'Unknown', kind }))
        .filter((event) => event.sem);
    const events = [
      ...toEvents(activity.recruitment, 'recruitment'),
      ...toEvents(activity.events, 'events'),
      ...toEvents(activity.outreach, 'outreach'),
    ];

    // semester label → { order, industries: { industry → { recruitment, events, outreach } } }
    const buckets = {};
    for (const event of events) {
      const key = event.sem.label;
      buckets[key] = buckets[key] || { order: event.sem.order, industries: {} };
      const industry = (buckets[key].industries[event.industry] = buckets[key].industries[event.industry] || {
        recruitment: 0,
        events: 0,
        outreach: 0,
      });
      industry[event.kind]++;
    }

    const total = (counts) => counts.recruitment + counts.events + counts.outreach;
    const rows = [];
    for (const [semester, data] of Object.entries(buckets).sort((a, b) => a[1].order - b[1].order)) {
      Object.entries(data.industries)
        .sort((a, b) => total(b[1]) - total(a[1]))
        .forEach(([industry, counts]) =>
          rows.push({
            Semester: semester,
            Industry: industry,
            'Recruitment Count': counts.recruitment,
            'Events Count': counts.events,
            'Outreach Count': counts.outreach,
            Total: total(counts),
          })
        );
    }

    // Stacked bar: one bar per semester, one segment per industry (top 8 industries overall).
    const industryTotals = {};
    for (const row of rows) industryTotals[row.Industry] = (industryTotals[row.Industry] || 0) + row.Total;
    const topIndustries = Object.entries(industryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([industry]) => industry);
    const labels = ctx.semesters().map((semester) => semester.label);
    const datasets = topIndustries.map((industry, index) => ({
      label: industry,
      data: labels.map((semester) => {
        const row = rows.find((item) => item.Semester === semester && item.Industry === industry);
        return row ? row.Total : 0;
      }),
      backgroundColor: PALETTE[index % PALETTE.length],
    }));
    return { rows, chartData: { type: 'bar', labels, datasets, stacked: true } };
  },

  'opportunities-per-semester': (ctx) => {
    const { queries, from, to } = ctx;
    const buckets = {};
    for (const row of queries.opportunityActivity(from, to)) {
      const semester = semesterOf(row.d);
      if (!semester) continue;
      const academicYear = academicYearOf(row.d);
      const chartLabel = academicYear ? `${academicYear.label} • ${semester.label}` : semester.label;
      const industry = row.industry || 'Unknown';
      const company = row.company || 'Unknown';
      const key = `${chartLabel}||${industry}`;
      const bucket = (buckets[key] = buckets[key] || {
        order: semester.order,
        chartLabel,
        semester: semester.label,
        academicYear: academicYear ? academicYear.label : 'Outside AY',
        industry,
        recruitment: 0,
        engagement: 0,
        companies: {},
      });
      bucket[row.kind]++;
      bucket.companies[company] = (bucket.companies[company] || 0) + 1;
    }

    const rows = Object.values(buckets)
      .sort((a, b) => a.order - b.order || b.recruitment + b.engagement - (a.recruitment + a.engagement))
      .map((bucket) => ({
        'Academic Year': bucket.academicYear,
        Semester: bucket.semester,
        Industry: bucket.industry,
        'Recruitment Count': bucket.recruitment,
        'Engagement Count': bucket.engagement,
        'Total Opportunities': bucket.recruitment + bucket.engagement,
        'Top Companies':
          Object.entries(bucket.companies)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, 3)
            .map(([company, count]) => `${company} (${count})`)
            .join(', ') || '—',
      }));

    const chartRows = Object.values(buckets);
    const industryTotals = {};
    for (const row of rows) {
      industryTotals[row.Industry] = (industryTotals[row.Industry] || 0) + row['Total Opportunities'];
    }
    const topIndustries = Object.entries(industryTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([industry]) => industry);
    const labels = ctx.semesters().map((semester) => {
      const academicYear = academicYearOf(semester.from);
      return academicYear ? `${academicYear.label} • ${semester.label}` : semester.label;
    });
    const datasets = topIndustries.map((industry, index) => ({
      label: industry,
      data: labels.map((label) => {
        const bucket = chartRows.find((item) => item.industry === industry && item.chartLabel === label);
        return bucket ? bucket.recruitment + bucket.engagement : 0;
      }),
      backgroundColor: PALETTE[index % PALETTE.length],
      borderRadius: 4,
    }));

    return { rows, chartData: { type: 'bar', labels, datasets, stacked: true } };
  },

  // Postings plus hires per company in the chosen period, compared with the period before.
  'top-recruiters': ({ queries, from, period, today }) => {
    const current = baseComparisonPeriod(period, from || today);
    const previous = previousComparisonPeriod(current);
    const countBy = (rows) => {
      const counts = {};
      for (const row of rows) counts[row.company] = (counts[row.company] || 0) + row.n;
      return counts;
    };
    const currentPostings = countBy(queries.postingsByCompany(current));
    const currentHires = countBy(queries.hiresByCompany(current));
    const previousPostings = countBy(queries.postingsByCompany(previous));
    const previousHires = countBy(queries.hiresByCompany(previous));

    const companies = [...new Set([...Object.keys(currentPostings), ...Object.keys(currentHires)])];
    const rows = companies
      .map((company) => {
        const postings = currentPostings[company] || 0;
        const hires = currentHires[company] || 0;
        const total = postings + hires;
        const previousTotal = (previousPostings[company] || 0) + (previousHires[company] || 0);
        return {
          Company: company,
          Postings: postings,
          Hires: hires,
          Total: total,
          [previous.label]: previousTotal,
          Change: changeLabel(total - previousTotal),
        };
      })
      .sort((a, b) => b.Total - a.Total);

    const top = rows.slice(0, 15);
    return {
      rows,
      chartData: {
        type: 'bar',
        indexAxis: 'y',
        labels: top.map((row) => row.Company),
        datasets: [
          {
            label: `Postings (${current.label})`,
            data: top.map((row) => row.Postings),
            backgroundColor: '#4361ee',
            borderRadius: 4,
          },
          {
            label: `Hires (${current.label})`,
            data: top.map((row) => row.Hires),
            backgroundColor: '#2ec4b6',
            borderRadius: 4,
          },
        ],
      },
    };
  },

  'top-roles-by-program': ({ queries, from, to }) => {
    const byMajor = {};
    for (const row of queries.rolesByProgram(from, to)) {
      const major = (byMajor[row.major] = byMajor[row.major] || {
        titles: {},
        roleTypes: {},
        postings: new Set(),
        paid: new Set(),
        hired: new Set(),
      });
      major.postings.add(row.recruitmentId);
      if (row.payStatus === 'Paid') major.paid.add(row.recruitmentId);
      if (row.hired === 'Yes') major.hired.add(row.recruitmentId);
      if (row.title) major.titles[row.title] = (major.titles[row.title] || 0) + 1;
      if (row.roleType) major.roleTypes[row.roleType] = (major.roleTypes[row.roleType] || 0) + 1;
    }

    const topThree = (counts) =>
      Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => `${name} (${count})`)
        .join(', ') || '—';

    const rows = Object.entries(byMajor)
      .sort((a, b) => b[1].postings.size - a[1].postings.size)
      .map(([major, data]) => {
        const postingCount = data.postings.size;
        return {
          Program: major,
          'Top Job Role Types': topThree(data.roleTypes),
          'Top Opportunity Titles': topThree(data.titles),
          'Posting Count': postingCount,
          'Paid %': postingCount ? Math.round((data.paid.size / postingCount) * 100) + '%' : '0%',
          'Hired Count': data.hired.size,
        };
      });

    const roleTypeTotals = {};
    for (const major of Object.values(byMajor)) {
      for (const [type, count] of Object.entries(major.roleTypes)) {
        roleTypeTotals[type] = (roleTypeTotals[type] || 0) + count;
      }
    }
    const topRoleTypes = Object.entries(roleTypeTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type]) => type);

    return {
      rows,
      chartData: {
        type: 'bar',
        indexAxis: 'y',
        stacked: true,
        labels: rows.map((row) => row.Program),
        datasets: topRoleTypes.length
          ? topRoleTypes.map((type, index) => ({
              label: type,
              data: rows.map((row) => byMajor[row.Program]?.roleTypes?.[type] || 0),
              backgroundColor: PALETTE[index % PALETTE.length],
              borderRadius: 4,
            }))
          : [
              {
                label: 'Postings',
                data: rows.map((row) => row['Posting Count']),
                backgroundColor: '#4361ee',
                borderRadius: 4,
              },
            ],
      },
    };
  },

  'activity-mix': (ctx) => {
    const { queries, from, to } = ctx;
    const dates = queries.activityDates(from, to);
    const buckets = {};
    for (const source of ACTIVITY_MIX_SOURCES) {
      for (const row of dates[source.key]) {
        const semester = semesterOf(row.d);
        if (!semester) continue;
        const bucket = (buckets[semester.label] = buckets[semester.label] || { order: semester.order, counts: {} });
        bucket.counts[source.label] = (bucket.counts[source.label] || 0) + 1;
      }
    }

    const rows = ctx.semesters().map((semester) => {
      const bucket = buckets[semester.label] || { counts: {} };
      const row = { Semester: semester.label };
      let total = 0;
      for (const source of ACTIVITY_MIX_SOURCES) {
        const count = bucket.counts[source.label] || 0;
        row[source.label] = count;
        total += count;
      }
      row.Total = total;
      return row;
    });

    return {
      rows,
      chartData: {
        type: 'bar',
        stacked: true,
        labels: rows.map((row) => row.Semester),
        datasets: ACTIVITY_MIX_SOURCES.map((source) => ({
          label: source.label,
          data: rows.map((row) => row[source.label]),
          backgroundColor: source.color,
          borderRadius: 4,
        })),
      },
    };
  },

  // One engagement per activity record, by the employer's sector and semester.
  'sector-engagement': (ctx) => {
    const { queries, from, to } = ctx;
    const buckets = {}; // semester label → { order, sectors: { sector → count } }
    for (const row of queries.sectorActivity(from, to)) {
      const semester = semesterOf(row.d);
      if (!semester) continue;
      const sector = row.sector || 'Unknown';
      const bucket = (buckets[semester.label] = buckets[semester.label] || { order: semester.order, sectors: {} });
      bucket.sectors[sector] = (bucket.sectors[sector] || 0) + 1;
    }
    const labels = ctx.semesters().map((semester) => semester.label);

    const rows = [];
    for (const [semester, bucket] of Object.entries(buckets).sort((a, b) => a[1].order - b[1].order)) {
      for (const sector of SECTORS) {
        const engagements = bucket.sectors[sector] || 0;
        if (engagements) rows.push({ Semester: semester, Sector: sector, Engagements: engagements });
      }
    }

    const datasets = SECTORS.map((sector, index) => ({
      label: sector,
      data: labels.map((label) => buckets[label]?.sectors?.[sector] || 0),
      borderColor: PALETTE[index],
      backgroundColor: PALETTE[index],
      fill: false,
      tension: 0.3,
    }));
    return { rows, chartData: { type: 'line', labels, datasets } };
  },

  'hiring-conversion': (ctx) => {
    const { queries, from, to } = ctx;
    const { postings, hires } = queries.postingAndHireDates(from, to);
    const buckets = {};
    const add = (list, key) => {
      for (const row of list) {
        const semester = semesterOf(row.d);
        if (!semester) continue;
        const bucket = (buckets[semester.label] = buckets[semester.label] || {
          order: semester.order,
          posted: 0,
          hired: 0,
        });
        bucket[key]++;
      }
    };
    add(postings, 'posted');
    add(hires, 'hired');

    const semesters = ctx.semesters();
    const rows = semesters.map((semester) => {
      const bucket = buckets[semester.label] || { posted: 0, hired: 0 };
      return {
        Semester: semester.label,
        Postings: bucket.posted,
        Hires: bucket.hired,
        Conversion: bucket.posted ? Math.round((bucket.hired / bucket.posted) * 100) + '%' : '0%',
      };
    });
    return {
      rows,
      chartData: {
        type: 'bar',
        labels: semesters.map((semester) => semester.label),
        datasets: [
          { label: 'Postings', data: rows.map((row) => row.Postings), backgroundColor: '#4361ee', borderRadius: 4 },
          { label: 'Hires', data: rows.map((row) => row.Hires), backgroundColor: '#2ec4b6', borderRadius: 4 },
        ],
      },
    };
  },

  'year-over-year-comparison': (ctx) => {
    const { queries, from, to, period } = ctx;
    const countsByYear = {};
    const add = (range, kind) => {
      for (const row of queries.opportunityDates(range, kind)) {
        const academicYear = academicYearOf(row.d);
        if (!academicYear) continue;
        const bucket = (countsByYear[academicYear.label] = countsByYear[academicYear.label] || {
          order: academicYear.order,
          recruitment: 0,
          engagement: 0,
        });
        bucket[kind]++;
      }
    };
    const addBoth = (range) => {
      add(range, 'recruitment');
      add(range, 'engagement');
    };

    if (period?.mode === 'academic-year' || period?.mode === 'semester') {
      const current =
        period.mode === 'academic-year'
          ? academicYearFromKey(period.academicYear)
          : academicYearForSemester(semesterFromKey(period.semester));
      addBoth(previousComparisonPeriod(current));
      addBoth(current);
    } else {
      addBoth({ from: from || '0000-01-01', to: to || '9999-12-31' });
    }

    const yearSeries =
      period?.mode === 'all'
        ? ctx.academicYears()
        : Object.entries(countsByYear)
            .sort((a, b) => a[1].order - b[1].order)
            .map(([label]) => ctx.academicYears().find((year) => year.label === label) || null)
            .filter(Boolean);

    const rows = yearSeries.map((year, index) => {
      const bucket = countsByYear[year.label] || { recruitment: 0, engagement: 0 };
      const previousBucket =
        index > 0 ? countsByYear[yearSeries[index - 1].label] || { recruitment: 0, engagement: 0 } : null;
      const diff = previousBucket
        ? bucket.recruitment + bucket.engagement - (previousBucket.recruitment + previousBucket.engagement)
        : 0;
      return {
        'Academic Year': year.label,
        'Engagement Volume': bucket.engagement,
        'Recruitment Volume': bucket.recruitment,
        'Total Volume': bucket.engagement + bucket.recruitment,
        'Change vs Previous AY': previousBucket ? changeLabel(diff) : '—',
      };
    });

    return {
      rows,
      chartData: {
        type: 'bar',
        labels: rows.map((row) => row['Academic Year']),
        datasets: [
          {
            label: 'Engagement',
            data: rows.map((row) => row['Engagement Volume']),
            backgroundColor: '#2ec4b6',
            borderRadius: 4,
          },
          {
            label: 'Recruitment',
            data: rows.map((row) => row['Recruitment Volume']),
            backgroundColor: '#4361ee',
            borderRadius: 4,
          },
        ],
      },
    };
  },

  'semester-comparison': (ctx) => {
    const { queries, from, period, today } = ctx;

    if (period?.mode === 'all') {
      const series = period.viewMode === 'academic-year' ? ctx.academicYears() : ctx.semesters();
      const rows = series.map((range, index) => {
        const currentMetrics = periodMetrics(queries, range);
        const previousMetrics = index > 0 ? periodMetrics(queries, series[index - 1]) : null;
        const currentTotal = sum(Object.values(currentMetrics));
        const previousTotal = previousMetrics ? sum(Object.values(previousMetrics)) : 0;
        return {
          Period: range.label,
          ...currentMetrics,
          'Total Activity': currentTotal,
          'Change vs Previous': previousMetrics ? changeLabel(currentTotal - previousTotal) : '—',
        };
      });
      return {
        rows,
        chartData: {
          type: 'bar',
          labels: rows.map((row) => row.Period),
          datasets: [
            {
              label: 'Total Activity',
              data: rows.map((row) => row['Total Activity']),
              backgroundColor: '#4361ee',
              borderRadius: 4,
            },
            {
              label: 'Students Hired',
              data: rows.map((row) => row['Students Hired']),
              backgroundColor: '#2ec4b6',
              borderRadius: 4,
            },
          ],
        },
      };
    }

    const current = baseComparisonPeriod(period, from || today);
    const previous = previousComparisonPeriod(current);
    const currentMetrics = periodMetrics(queries, current);
    const previousMetrics = periodMetrics(queries, previous);
    const rows = Object.keys(currentMetrics).map((metric) => {
      const diff = currentMetrics[metric] - previousMetrics[metric];
      return {
        Metric: metric,
        [current.label]: currentMetrics[metric],
        [previous.label]: previousMetrics[metric],
        Change: changeLabel(diff),
        Trend: diff > 0 ? 'Improved' : diff < 0 ? 'Declined' : 'Unchanged',
      };
    });

    return {
      rows,
      chartData: {
        type: 'bar',
        labels: Object.keys(currentMetrics),
        datasets: [
          { label: current.label, data: Object.values(currentMetrics), backgroundColor: '#4361ee', borderRadius: 4 },
          { label: previous.label, data: Object.values(previousMetrics), backgroundColor: '#adb5bd', borderRadius: 4 },
        ],
      },
    };
  },
};
