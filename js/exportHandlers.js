/**
 * Export Handlers Module
 * Handles multi-format export of analytics reports and custom lists
 * Supports CSV, Excel (.xlsx), and PDF formats
 */

class ExportHandlers {
  constructor() {
    this.formatters = {
      csv: this.exportAsCSV.bind(this),
      excel: this.exportAsExcel.bind(this),
      pdf: this.exportAsPDF.bind(this)
    };
  }

  /**
   * Main export dispatcher
   */
  async exportList(reportData, format) {
    try {
      if (!this.formatters[format]) {
        throw new Error(`Unknown export format: ${format}`);
      }

      await this.formatters[format](reportData);
    } catch (error) {
      if (window.Logger) window.Logger.error(`Error exporting as ${format}:`, error);
      alert(`Export failed: ${error.message}`);
    }
  }

  /**
   * Export as CSV format
   */
  async exportAsCSV(reportData) {
    const { title, columns, data } = reportData;

    // Prepare CSV content
    let csv = '';

    // Add header with title and metadata
    csv += `"${title}"\n`;
    csv += `"Generated: ${new Date().toLocaleString()}"\n`;
    csv += `"Total Records: ${data.length}"\n`;
    csv += '\n';

    // Add column headers
    csv += columns.map(col => `"${this.formatColumnName(col)}"`).join(',') + '\n';

    // Add data rows
    data.forEach(row => {
      const rowValues = columns.map(col => {
        const value = row[col];
        if (value === null || value === undefined) return '';
        
        // Escape quotes and handle special characters
        const strValue = String(value);
        if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
          return `"${strValue.replace(/"/g, '""')}"`;
        }
        return `"${strValue}"`;
      });
      csv += rowValues.join(',') + '\n';
    });

    // Add summary statistics if available
    if (Object.keys(reportData.summary || {}).length > 0) {
      csv += '\n"Summary Statistics"\n';
      Object.entries(reportData.summary).forEach(([key, value]) => {
        csv += `"${key}","${value}"\n`;
      });
    }

    // Download file
    this.downloadFile(
      csv,
      `${reportData.id}_${new Date().toISOString().split('T')[0]}.csv`,
      'text/csv;charset=utf-8;'
    );

    if (window.Logger) window.Logger.info(`Exported ${data.length} records as CSV`);
  }

  /**
   * Export as Excel format (.xlsx)
   * Requires SheetJS library (https://github.com/SheetJS/sheetjs)
   */
  async exportAsExcel(reportData) {
    // Check if SheetJS is available
    if (typeof XLSX === 'undefined') {
      // Fallback to CSV if SheetJS not loaded
      if (window.Logger) window.Logger.warn('SheetJS not available, falling back to CSV export');
      return this.exportAsCSV(reportData);
    }

    const { title, columns, data } = reportData;

    try {
      // Create workbook
      const wb = XLSX.utils.book_new();

      // Sheet 1: Main Data
      const mainData = [
        columns.map(col => this.formatColumnName(col)),
        ...data.map(row => columns.map(col => row[col] || ''))
      ];

      const ws_data = XLSX.utils.aoa_to_sheet(mainData);
      
      // Style headers (if SheetJS Pro or compatible)
      if (ws_data['!ref']) {
        const range = XLSX.utils.decode_range(ws_data['!ref']);
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const address = XLSX.utils.encode_col(C) + '1';
          if (ws_data[address]) {
            ws_data[address].s = {
              font: { bold: true, color: { rgb: 'FFFFFF' } },
              fill: { fgColor: { rgb: '366092' } },
              alignment: { horizontal: 'center' }
            };
          }
        }
      }

      XLSX.utils.book_append_sheet(wb, ws_data, 'Data');

      // Sheet 2: Summary Statistics
      if (Object.keys(reportData.summary || {}).length > 0) {
        const summaryData = [
          ['Metric', 'Value'],
          ...Object.entries(reportData.summary).map(([key, value]) => [key, value])
        ];
        const ws_summary = XLSX.utils.aoa_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, ws_summary, 'Summary');
      }

      // Sheet 3: Metadata
      const metadataData = [
        ['Report Information'],
        ['Title', title],
        ['Generated', new Date().toLocaleString()],
        ['Total Records', data.length],
        ['Columns', columns.length],
        ['Export Format', 'Excel (.xlsx)']
      ];
      const ws_metadata = XLSX.utils.aoa_to_sheet(metadataData);
      XLSX.utils.book_append_sheet(wb, ws_metadata, 'Metadata');

      // Write file
      const fileName = `${reportData.id}_${new Date().toISOString().split('T')[0]}.xlsx`;
      XLSX.writeFile(wb, fileName);

      if (window.Logger) window.Logger.info(`Exported ${data.length} records as Excel`);
    } catch (error) {
      if (window.Logger) window.Logger.error('Error in Excel export:', error);
      // Fallback to CSV
      return this.exportAsCSV(reportData);
    }
  }

  /**
   * Export as PDF format
   * Requires jsPDF + html2canvas libraries
   */
  async exportAsPDF(reportData) {
    // Check if required libraries are available
    // jsPDF UMD bundle exposes as window.jspdf.jsPDF
    const JsPDF = (typeof jsPDF !== 'undefined') ? jsPDF : (window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : null;
    if (!JsPDF) {
      LOG.warn('jsPDF library not available, falling back to CSV export');
      if (window.showToast) window.showToast('info', 'PDF library not loaded. Exporting as CSV instead.');
      return this.exportAsCSV(reportData);
    }

    const { title, columns, data } = reportData;

    try {
      // Create PDF document (A4 landscape for better table display)
      const doc = new JsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();
      let yPosition = 10;

      // Title Page
      doc.setFontSize(16);
      doc.text(title, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 10;

      doc.setFontSize(10);
      doc.text(`Report Generated: ${new Date().toLocaleString()}`, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 5;
      doc.text(`Total Records: ${data.length}`, pageWidth / 2, yPosition, { align: 'center' });
      yPosition += 15;

      // Prepare table data
      const tableData = [
        columns.map(col => this.formatColumnName(col)),
        ...data.map(row => columns.map(col => {
          const value = row[col];
          if (value === null || value === undefined) return '';
          return String(value).substring(0, 30); // Limit cell content length
        }))
      ];

      // Use autoTable plugin if available, otherwise create basic table
      if (doc.autoTable) {
        doc.autoTable({
          head: [tableData[0]],
          body: tableData.slice(1),
          startY: yPosition,
          theme: 'grid',
          styles: {
            fontSize: 8,
            cellPadding: 2
          },
          headStyles: {
            fillColor: [54, 96, 146],
            textColor: [255, 255, 255],
            fontStyle: 'bold'
          },
          alternateRowStyles: {
            fillColor: [240, 240, 240]
          }
        });

        yPosition = doc.lastAutoTable.finalY + 10;
      } else {
        // Fallback: simple text-based table
        doc.setFontSize(8);
        const colWidth = (pageWidth - 20) / columns.length;

        let currentY = yPosition;
        tableData.forEach((row, rowIdx) => {
          let startY = currentY;
          row.forEach((cell, colIdx) => {
            const x = 10 + (colIdx * colWidth);
            doc.text(String(cell).substring(0, 15), x, currentY);
          });
          currentY += 5;

          // Add page break if needed
          if (currentY > pageHeight - 20) {
            doc.addPage();
            currentY = 10;
          }
        });

        yPosition = currentY + 10;
      }

      // Add summary statistics if available
      if (Object.keys(reportData.summary || {}).length > 0) {
        if (yPosition > pageHeight - 30) {
          doc.addPage();
          yPosition = 10;
        }

        doc.setFontSize(10);
        doc.text('Summary Statistics', 10, yPosition);
        yPosition += 8;

        doc.setFontSize(8);
        Object.entries(reportData.summary).forEach(([key, value]) => {
          doc.text(`${key}: ${value}`, 10, yPosition);
          yPosition += 5;
        });
      }

      // Add footer to all pages
      const totalPages = doc.internal.pages.length;
      doc.setFontSize(8);
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.text(
          `Page ${i} of ${totalPages}`,
          pageWidth / 2,
          pageHeight - 5,
          { align: 'center' }
        );
      }

      // Save PDF
      const fileName = `${reportData.id}_${new Date().toISOString().split('T')[0]}.pdf`;
      doc.save(fileName);

      if (window.Logger) window.Logger.info(`Exported ${data.length} records as PDF`);
    } catch (error) {
      if (window.Logger) window.Logger.error('Error in PDF export:', error);
      // Fallback to CSV
      return this.exportAsCSV(reportData);
    }
  }

  /**
   * Generic file download helper
   */
  downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /**
   * Format column name for display
   */
  formatColumnName(col) {
    return col
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, str => str.toUpperCase())
      .trim();
  }

  /**
   * Export analytics chart as image
   */
  async exportChartAsImage(chartId, filename = null) {
    const canvas = document.getElementById(chartId);
    if (!canvas) {
      if (window.Logger) window.Logger.warn(`Chart element #${chartId} not found`);
      return;
    }

    try {
      canvas.toBlob((blob) => {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename || `chart_${new Date().toISOString().split('T')[0]}.png`;
        link.click();
        URL.revokeObjectURL(link.href);
      });
    } catch (error) {
      if (window.Logger) window.Logger.error('Error exporting chart as image:', error);
      alert('Error exporting chart as image');
    }
  }

  /**
   * Batch export multiple lists
   */
  async batchExportLists(reportDataArray, format) {
    if (window.Logger) window.Logger.info(`Batch exporting ${reportDataArray.length} reports as ${format}`);

    for (const reportData of reportDataArray) {
      await this.exportList(reportData, format);
      // Small delay between exports to avoid overwhelming the system
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    if (window.Logger) window.Logger.info('Batch export complete');
  }
}

// Export for use in other modules
window.ExportHandlers = new ExportHandlers();
