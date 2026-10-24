module.exports=({run})=>{
 run('Manual listing date/time accepts explicit dates and rejects impossible values',(r,ok)=>{
  ok(r('return JSON.stringify(parsePostDate("28.10.2026 14:30"))')==='{"date":"2026-10-28","time":"14:30"}','typed date and time remain exact');
  ok(r('return JSON.stringify(parsePostDate("2.11.2026 9:05"))')==='{"date":"2026-11-02","time":"09:05"}','single digit day and hour normalize');
  for(const value of ['31.02.2026 12:00','28.10.2026 24:00','28.10.2026 14:60','yarın öğleden sonra',''])ok(r('return !parsePostDate('+JSON.stringify(value)+').date'),'ambiguous/impossible input rejected: '+value);
  ok(r('return parsePostDate("28.10.2026").date')==='2026-10-28','date without optional time accepted');
  ok(r('return parsePostDate("2026-10-28").date')==='2026-10-28','existing ISO dates remain compatible');
  ok(r('return dateLabel({date:"2026-10-28",time:"14:30"}).endsWith(" · 14:30")'),'saved time is shown in listing date');
 });
};
